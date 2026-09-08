/** In-memory operation identity; no patient data is written to browser storage. */
export class BookingSubmissionAttempt<T extends object>{
 private attempt:{id:string;payload:T;fingerprint:string}|null=null;
 inFlight=false;
 uncertain=false;
 begin(payload:T,id:()=>string){
  if(this.inFlight)return null;
  const fingerprint=JSON.stringify(payload);
  if(!this.attempt||(!this.uncertain&&this.attempt.fingerprint!==fingerprint))this.attempt={id:id(),payload:structuredClone(payload),fingerprint};
  this.inFlight=true;return this.attempt;
 }
 finish(kind:"success"|"uncertain"|"rejected"){
  this.inFlight=false;
  if(kind==="success"){this.uncertain=false;this.attempt=null;}
  else if(kind==="uncertain")this.uncertain=true;
 }
}
