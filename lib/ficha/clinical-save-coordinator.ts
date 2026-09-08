import {esBorradorSucio,type BorradorFicha} from "./borrador";

export type ClinicalSaveMode="SAVE"|"AUTOSAVE"|"CLOSE";
export interface ClinicalSaveOperation {
  operationId:string;
  expectedRevision:number;
  mode:ClinicalSaveMode;
  draft:BorradorFicha;
}

/** Lives only in the mounted editor. No clinical plaintext is persisted in browser
 * storage. Server refreshes cannot silently move a local draft's revision. */
export class ClinicalSaveCoordinator {
  revision:number;
  baseline:BorradorFicha;
  inFlight=false;
  conflicted=false;
  closed=false;
  uncertain:ClinicalSaveOperation|null=null;
  private active:ClinicalSaveOperation|null=null;
  constructor(revision:number,baseline:BorradorFicha){this.revision=revision;this.baseline=structuredClone(baseline);}
  isDirty(draft:BorradorFicha){return esBorradorSucio(draft,this.baseline);}
  begin(draft:BorradorFicha,mode:ClinicalSaveMode,operationId:string):ClinicalSaveOperation|null {
    if(this.inFlight||this.conflicted||this.closed)return null;
    if(this.uncertain&&mode!==this.uncertain.mode)return null;
    const operation=this.uncertain??{operationId,expectedRevision:this.revision,mode,draft:structuredClone(draft)};
    this.inFlight=true;this.active=operation;return operation;
  }
  acknowledge(operation:ClinicalSaveOperation,result:{revision:number;closed:boolean}){
    if(this.active!==operation)return false;
    if(!Number.isSafeInteger(result.revision)||result.revision<=operation.expectedRevision){
      this.reject(operation,"uncertain");return false;
    }
    this.revision=result.revision;this.baseline=operation.draft;this.closed=result.closed;
    this.inFlight=false;this.active=null;this.uncertain=null;return true;
  }
  reject(operation:ClinicalSaveOperation,kind:"uncertain"|"conflict"|"rejected"){
    if(this.active!==operation)return;
    this.inFlight=false;this.active=null;
    this.uncertain=kind==="uncertain"?operation:null;
    if(kind==="conflict")this.conflicted=true;
  }
}
