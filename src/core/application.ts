import type { AuditPort, Persistence } from "./ports";
import { HistoryService, GigPeopleService, PeopleService } from "./services";
import { InteractionService } from "./interaction-service";
import { GigDomainService } from "./gig-domain-service";
import { TaskDomainService } from "./task-domain-service";
import { ChangeExecutor, ChangeService } from "./changes";
import { ManagedDocumentService } from "./managed-document-service";
import { SearchContextService } from "./context-search";
import { ApplicationDocumentReader } from "./document-reader";
import {
  ApplicationSettingsService,
  defaultAgentModelId,
  type AgentModelId,
} from "./application-settings";

/** Application API shared by the web server, CLI, and automation. */
export class GigFinderApplication {
  readonly gigs:GigDomainService;readonly people:PeopleService;readonly tasks:TaskDomainService;readonly interactions:InteractionService;readonly gigPeople:GigPeopleService;readonly history:HistoryService;readonly changes:ChangeService;readonly documents:ManagedDocumentService;readonly documentReader:ApplicationDocumentReader;readonly contextSearch:SearchContextService;readonly settings:ApplicationSettingsService;
  constructor(persistence:Persistence,audit:AuditPort,defaultAgentModel:AgentModelId=defaultAgentModelId){
    const changeExecutor=new ChangeExecutor(persistence);
    this.documents=new ManagedDocumentService(persistence);this.gigs=new GigDomainService(persistence,changeExecutor,this.documents);this.people=new PeopleService(persistence,changeExecutor,this.documents);this.tasks=new TaskDomainService(persistence,this.gigs,this.people,changeExecutor);this.interactions=new InteractionService(persistence,this.gigs,this.people,changeExecutor);this.gigPeople=new GigPeopleService(persistence,this.gigs,this.people);this.history=new HistoryService(audit);this.changes=new ChangeService(persistence);
    this.documentReader=new ApplicationDocumentReader({gigs:this.gigs,people:this.people,managed:this.documents});
    this.contextSearch=new SearchContextService({gigs:this.gigs,people:this.people});
    this.settings=new ApplicationSettingsService(persistence.settings,defaultAgentModel);
  }
}
