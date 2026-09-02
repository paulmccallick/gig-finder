import type { ArtifactPort, Persistence } from "./ports";
import type { ChangeContext, EntityRecord, GigData } from "./models";

export class ArtifactDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort){}
  verify(){return this.artifacts.verify({gigs:this.p.gigs.list({includeDeleted:true}).map(j=>({id:j.id,hasJobDescription:j.hasJobDescription,hasInterviewPrep:j.hasInterviewPrep}))})}
  async sync(context:ChangeContext){
    for(const gig of this.p.gigs.list({includeDeleted:true})){const hasJobDescription=await this.artifacts.jobDescriptionExists(gig.id),hasInterviewPrep=await this.artifacts.interviewPrepExists(gig.id);if(hasJobDescription!==gig.hasJobDescription||hasInterviewPrep!==gig.hasInterviewPrep)this.updateGig(context,gig,hasJobDescription,hasInterviewPrep)}
    return{gigs:this.p.gigs.list({includeDeleted:true}).filter(j=>j.hasJobDescription||j.hasInterviewPrep).length}
  }
  private updateGig(context:ChangeContext,record:EntityRecord<GigData>,hasJobDescription:boolean,hasInterviewPrep:boolean){this.p.change({...context,summary:`Sync gig artifact ${record.id}`},u=>{const patch={hasJobDescription,hasInterviewPrep};if(!record.isDeleted)return u.gigs.update(record.id,record.revision,patch);const restored=u.gigs.restore(record.id,record.revision,patch);return u.gigs.delete(record.id,restored.revision)})}
}
