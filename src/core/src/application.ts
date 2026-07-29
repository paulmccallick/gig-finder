import type { ArtifactPort, AuditPort, Persistence } from "./ports";
import { EventService, HistoryService, JobPeopleService, MeetingService, PeopleService } from "./services";
import { ArtifactDomainService, ContactDomainService, JobDomainService, TaskDomainService } from "./tracker-services";
import { ApplicationAgentDocumentSource, JobSearchAgentContext } from "./agent-context";
import { ChangeExecutor, ChangeService } from "./changes";
import { ManagedDocumentService } from "./documents";
import { SearchContextService } from "./context-search";

/** Application API shared by the web server, CLI, and automation. */
export class JobSearchApplication {
  readonly jobs:JobDomainService;readonly people:PeopleService;readonly networking:ContactDomainService;readonly tasks:TaskDomainService;readonly meetings:MeetingService;readonly jobPeople:JobPeopleService;readonly events:EventService;readonly history:HistoryService;readonly changes:ChangeService;readonly artifacts:ArtifactDomainService;readonly documents:ManagedDocumentService;readonly agentContext:JobSearchAgentContext;readonly contextSearch:SearchContextService;
  constructor(persistence:Persistence,audit:AuditPort,artifacts:ArtifactPort){
    const changeExecutor=new ChangeExecutor(persistence);
    this.jobs=new JobDomainService(persistence,artifacts,changeExecutor);this.people=new PeopleService(persistence,artifacts);this.networking=new ContactDomainService(persistence,changeExecutor);this.tasks=new TaskDomainService(persistence);this.meetings=new MeetingService(persistence);this.jobPeople=new JobPeopleService(persistence);this.events=new EventService(persistence);this.history=new HistoryService(audit);this.changes=new ChangeService(persistence);this.artifacts=new ArtifactDomainService(persistence,artifacts);this.documents=new ManagedDocumentService(persistence);
    this.agentContext=new JobSearchAgentContext({
      jobs:this.jobs,
      networking:this.networking,
      tasks:this.tasks,
      documents:new ApplicationAgentDocumentSource({jobs:this.jobs,people:this.people,contacts:this.networking,managed:this.documents}),
    });
    this.contextSearch=new SearchContextService({jobs:this.jobs,networking:this.networking});
  }
}
