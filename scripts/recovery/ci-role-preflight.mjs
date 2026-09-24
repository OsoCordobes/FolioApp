const pgsodiumRoles=new Set(['pgsodium_keyiduser','pgsodium_keyholder','pgsodium_keymaker']);
const versionPattern=/^[0-9]+(?:\.[0-9]+){1,3}$/;

/** Decide from verified inventory only. Never turn manifest names into SQL. */
export function planRolePreparation({sourceRoles,destinationRoles,sourceExtensions,availablePgsodium,availableVersions,targetExists}){
 if(!Array.isArray(sourceRoles)||!Array.isArray(destinationRoles)||!Array.isArray(sourceExtensions)||!Array.isArray(availableVersions))
  throw Error('c01_role_inventory_invalid');
 if(typeof targetExists!=='boolean')throw Error('c01_target_presence_invalid');
 const sourceNames=sourceRoles.map(role=>role?.rolname);
 if(sourceNames.some(name=>typeof name!=='string'||name.length===0))throw Error('c01_source_roles_invalid');
 if(destinationRoles.some(name=>typeof name!=='string'||name.length===0))throw Error('c01_destination_roles_invalid');
 const destination=new Set(destinationRoles);
 const missing=[...new Set(sourceNames)].filter(name=>!destination.has(name));
 const knownMissing=missing.filter(name=>pgsodiumRoles.has(name)).sort();
 const unknownCount=missing.length-knownMissing.length;
 const report={knownMissing,unknownCount};
 if(targetExists)return {...report,action:'target_exists'};
 if(missing.length===0)return {...report,action:'none'};
 if(unknownCount>0)return {...report,action:'unknown_roles'};
 const sourcePgsodium=sourceExtensions.filter(extension=>extension?.name==='pgsodium');
 if(sourcePgsodium.length!==1)return {...report,action:'source_extension_missing'};
 const version=sourcePgsodium[0].version;
 if(typeof version!=='string'||!versionPattern.test(version))return {...report,action:'source_version_invalid'};
 if(availablePgsodium?.name!=='pgsodium'||
    availablePgsodium.installed_version!==null||
    !availableVersions.includes(version))
  return {...report,action:'destination_extension_mismatch'};
 return {...report,action:'install_pgsodium',version};
}
