/** Classify Docker failures without exposing raw output from the isolated proof. */
export function dockerFailureKind(output){
 const message=String(output).toLowerCase();
 if(/toomanyrequests|rate limit/.test(message))return 'registry_rate_limit';
 if(/manifest unknown|not found|pull access denied/.test(message))return 'image_unavailable';
 if(/unhealthy|health check|healthcheck/.test(message))return 'unhealthy';
 if(/cannot connect to the docker daemon|is the docker daemon running/.test(message))return 'daemon_unavailable';
 if(/address already in use|port is already allocated/.test(message))return 'port_conflict';
 if(/timeout|timed out|connection reset|tls handshake|no route to host|temporary failure|network is unreachable/.test(message))return 'network';
 return 'unknown';
}
