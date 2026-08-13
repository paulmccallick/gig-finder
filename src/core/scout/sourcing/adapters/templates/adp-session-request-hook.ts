import type { ReusableJsonRequestHook, ReusableJsonTemplateSource } from "./types";
import { object, text } from "./support";
export class AdpSessionRequestHook implements ReusableJsonRequestHook {
  request(source: ReusableJsonTemplateSource) {
    const configured = new URL(source.url);
    if (configured.pathname.startsWith("/public/staffing/v1/career-site/"))
      return { url: configured.toString(), method: "GET" as const };
    const domain = configured.pathname.split("/").filter(Boolean)[0];
    return {
      url: new URL(
        `/public/staffing/v1/career-site/${domain}`,
        configured.origin,
      ).toString(),
      method: "GET" as const,
    };
  }
  listingRequest(_source: ReusableJsonTemplateSource, body: string) {
    const value = object(JSON.parse(body)),
      token = text(value.myJobsToken),
      origin = text(object(value.properties).myadpUrl) || "https://my.adp.com";
    if (!token) return null;
    const url = new URL(
      "/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters",
      origin,
    );
    url.searchParams.set(
      "$select",
      "reqId,jobTitle,publishedJobTitle,jobDescription,jobQualifications,workLocations,clientRequisitionID,requisitionLocations",
    );
    url.searchParams.set("$top", "100");
    url.searchParams.set("$filter", "");
    return {
      url: url.toString(),
      method: "GET" as const,
      headers: {
        myjobstoken: token,
        rolecode: "manager",
        referer: "https://myjobs.adp.com/",
      },
    };
  }
}
