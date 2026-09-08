import {installIsolation} from './install-isolation.mjs';
import {safeEnvironment} from './isolation-policy.mjs';
installIsolation();
const clean=safeEnvironment(process.env,{mode:'unit'});
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean);

// Node children inherit the same guard; non-Node manual maintenance is separate.
process.env.NODE_OPTIONS=`--import=${import.meta.url}`;
