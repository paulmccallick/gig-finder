/** @deprecated Import entity-owned input contracts from the corresponding domain module. */
export { gigInputSchema as gigUpdateSchema, type GigInput as GigUpdate } from "./gigs";
export { personInputSchema as personUpdateSchema, type PersonInput as PersonUpdate } from "./people";
export { meetingInputSchema as meetingUpdateSchema, type MeetingInput as MeetingUpdate } from "./meetings";
export {
  taskInputSchema as taskCreateSchema,
  taskInputSchema as taskUpdateSchema,
  taskRelatedEntityInputSchema,
  type TaskRelatedEntityInput,
  type TaskInput as TaskCreate,
  type TaskInput as TaskUpdate,
} from "./tasks";
