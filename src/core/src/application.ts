import type { ArtifactPort, AuditPort, Persistence } from "./ports";
import { EventService, HistoryService, JobPeopleService, MeetingService, PeopleService } from "./services";
import { ArtifactDomainService, ContactDomainService, JobDomainService, TaskDomainService } from "./tracker-services";
import { ApplicationAgentDocumentSource, JobSearchAgentContext } from "./agent-context";

/** Application API shared by the web server, CLI, and automation. */
export class JobSearchApplication {
  readonly jobs:JobDomainService;readonly people:PeopleService;readonly networking:ContactDomainService;readonly tasks:TaskDomainService;readonly meetings:MeetingService;readonly jobPeople:JobPeopleService;readonly events:EventService;readonly history:HistoryService;readonly artifacts:ArtifactDomainService;readonly agentContext:JobSearchAgentContext;
  constructor(persistence:Persistence,audit:AuditPort,artifacts:ArtifactPort){
    this.jobs=new JobDomainService(persistence,artifacts);this.people=new PeopleService(persistence,artifacts);this.networking=new ContactDomainService(persistence);this.tasks=new TaskDomainService(persistence);this.meetings=new MeetingService(persistence);this.jobPeople=new JobPeopleService(persistence);this.events=new EventService(persistence);this.history=new HistoryService(audit);this.artifacts=new ArtifactDomainService(persistence,artifacts);
    this.agentContext=new JobSearchAgentContext({
      jobs:this.jobs,
      networking:this.networking,
      tasks:this.tasks,
      documents:new ApplicationAgentDocumentSource({jobs:this.jobs,people:this.people}),
    });
  }
}
