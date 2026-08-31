import { dlopen, read } from "bun:ffi";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
} from "node:fs";
import { getSystemErrorName } from "node:util";

const relativeFilesystemSymbols = {
  openat: {
    args: ["i32", "cstring", "i32", "i32"],
    returns: "i32",
  },
  mkdirat: {
    args: ["i32", "cstring", "i32"],
    returns: "i32",
  },
  renameat: {
    args: ["i32", "cstring", "i32", "cstring"],
    returns: "i32",
  },
  unlinkat: {
    args: ["i32", "cstring", "i32"],
    returns: "i32",
  },
} as const;

function loadRelativeFilesystem() {
  if (process.platform === "darwin") {
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      ...relativeFilesystemSymbols,
      __error: { args: [], returns: "ptr" },
    });
    return {
      library,
      ...library.symbols,
      errno: () => read.i32(library.symbols.__error()!),
    };
  }
  if (process.platform === "linux") {
    const library = dlopen("libc.so.6", {
      ...relativeFilesystemSymbols,
      __errno_location: { args: [], returns: "ptr" },
    });
    return {
      library,
      ...library.symbols,
      errno: () => read.i32(library.symbols.__errno_location()!),
    };
  }
  throw new Error("Descriptor-relative filesystem access requires macOS or Linux.");
}

const relativeFilesystem = loadRelativeFilesystem();

export interface DirectoryDescriptor {
  fd: number;
  close(): void;
}

function componentBuffer(component: string) {
  if (
    !component
    || component === "."
    || component === ".."
    || component.includes("/")
    || component.includes("\0")
  ) {
    throw new Error("Descriptor-relative path contains an invalid component.");
  }
  return Buffer.from(`${component}\0`);
}

function nativeError(operation: string) {
  const errno = relativeFilesystem.errno();
  let code = `ERRNO_${errno}`;
  try {
    code = getSystemErrorName(-errno);
  } catch {
    // Preserve the bounded numeric fallback for an unknown platform errno.
  }
  const error = new Error(`${operation} failed with ${code}.`) as NodeJS.ErrnoException;
  error.code = code;
  error.errno = -errno;
  return error;
}

function descriptor(fd: number): DirectoryDescriptor {
  let open = true;
  return {
    fd,
    close() {
      if (!open) return;
      open = false;
      closeSync(fd);
    },
  };
}

export function hasDescriptorErrorCode(error: unknown, ...codes: string[]) {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && codes.includes(error.code);
}

export function openRootDirectory(root: string) {
  const expected = lstatSync(root);
  if (expected.isSymbolicLink()) {
    throw new Error("Descriptor root must not be a symbolic link.");
  }
  if (!expected.isDirectory()) {
    throw new Error("Descriptor root must be a directory.");
  }

  const fd = openSync(
    root,
    constants.O_RDONLY
      | constants.O_DIRECTORY
      | constants.O_NOFOLLOW
      | constants.O_NONBLOCK,
  );
  try {
    const actual = fstatSync(fd);
    if (
      !actual.isDirectory()
      || actual.dev !== expected.dev
      || actual.ino !== expected.ino
    ) {
      throw new Error("Descriptor root identity changed while it was opened.");
    }
    return descriptor(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function openDirectoryAt(parent: DirectoryDescriptor, component: string) {
  const fd = relativeFilesystem.openat(
    parent.fd,
    componentBuffer(component),
    constants.O_RDONLY
      | constants.O_DIRECTORY
      | constants.O_NOFOLLOW
      | constants.O_NONBLOCK,
    0,
  );
  if (fd < 0) throw nativeError("openat directory");
  const metadata = fstatSync(fd);
  if (!metadata.isDirectory()) {
    closeSync(fd);
    throw new Error("Descriptor-relative path component must be a directory.");
  }
  return descriptor(fd);
}

export function createDirectoryAt(
  parent: DirectoryDescriptor,
  component: string,
  mode: number,
) {
  const result = relativeFilesystem.mkdirat(
    parent.fd,
    componentBuffer(component),
    mode,
  );
  if (result < 0) throw nativeError("mkdirat");
}

export function openFileAt(
  parent: DirectoryDescriptor,
  component: string,
  flags: number,
  mode = 0,
) {
  const fd = relativeFilesystem.openat(
    parent.fd,
    componentBuffer(component),
    flags,
    mode,
  );
  if (fd < 0) throw nativeError("openat file");
  return fd;
}

export function replaceAt(
  parent: DirectoryDescriptor,
  source: string,
  destination: string,
) {
  const result = relativeFilesystem.renameat(
    parent.fd,
    componentBuffer(source),
    parent.fd,
    componentBuffer(destination),
  );
  if (result < 0) throw nativeError("renameat");
}

export function removeAt(parent: DirectoryDescriptor, component: string) {
  const result = relativeFilesystem.unlinkat(
    parent.fd,
    componentBuffer(component),
    0,
  );
  if (result < 0) throw nativeError("unlinkat");
}
