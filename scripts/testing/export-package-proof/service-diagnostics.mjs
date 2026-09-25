// Only these fixed fields may leave a failed disposable Compose stack.
const statuses=new Set(['created','running','paused','restarting','removing','exited','dead']);
const healths=new Set(['healthy','unhealthy','starting']);
export const SERVICES=['db','auth','rest','storage','api-gw','minio','minio-createbucket'];

export function safeServiceState(service,raw){
 const safeService=SERVICES.includes(service)?service:'unknown';
 const status=statuses.has(raw?.Status)?raw.Status:'unknown';
 const exitCode=Number.isInteger(raw?.ExitCode)&&raw.ExitCode>=0&&raw.ExitCode<=255
  ?raw.ExitCode:null;
 const health=healths.has(raw?.Health?.Status)?raw.Health.Status:'none';
 return {service:safeService,status,exitCode,health};
}
