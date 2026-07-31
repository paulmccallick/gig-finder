import type { ArtifactPort, AuditPort, Persistence } from "./ports";
import { EventService, HistoryService, JobPeopleService, MeetingService, PeopleService } from "./services";
import { ArtifactDomainService, ContactDomainService, JobDomainService, TaskDomainService } from "./tracker-services";
import { ChangeExecutor, ChangeService } from "./changes";
import { ManagedDocumentService } from "./documents";
import { SearchContextService } from "./context-search";
import { ApplicationDocumentReader } from "./document-reader";

/** Application API shared by the web server, CLI, and automation. */
export class JobSearchApplication {
  readonly jobs:JobDomainService;readonly people:PeopleService;readonly networking:ContactDomainService;readonly tasks:TaskDomainService;readonly meetings:MeetingService;readonly jobPeople:JobPeopleService;readonly events:EventService;readonly history:HistoryService;readonly changes:ChangeService;readonly artifacts:ArtifactDomainService;readonly documents:ManagedDocumentService;readonly documentReader:ApplicationDocumentReader;readonly contextSearch:SearchContextService;
  constructor(persistence:Persistence,audit:AuditPort,artifacts:ArtifactPort){
    const changeExecutor=new ChangeExecutor(persistence);
    this.documents=new ManagedDocumentService(persistence);this.jobs=new JobDomainService(persistence,artifacts,changeExecutor,this.documents);this.people=new PeopleService(persistence);this.networking=new ContactDomainService(persistence,changeExecutor,this.documents);this.tasks=new TaskDomainService(persistence);this.meetings=new MeetingService(persistence,this.jobs,this.people);this.jobPeople=new JobPeopleService(persistence,this.jobs,this.people);this.events=new EventService(persistence);this.history=new HistoryService(audit);this.changes=new ChangeService(persistence);this.artifacts=new ArtifactDomainService(persistence,artifacts);
    this.documentReader=new ApplicationDocumentReader({jobs:this.jobs,contacts:this.networking,managed:this.documents});
    this.contextSearch=new SearchContextService({jobs:this.jobs,networking:this.networking});
  }
}
