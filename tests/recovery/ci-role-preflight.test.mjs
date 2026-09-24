import assert from 'node:assert/strict';
import test from 'node:test';
import {planRolePreparation} from '../../scripts/recovery/ci-role-preflight.mjs';

function inventory(){return {
 sourceRoles:[{rolname:'postgres'},{rolname:'pgsodium_keyiduser'},{rolname:'pgsodium_keyholder'},{rolname:'pgsodium_keymaker'}],
 destinationRoles:['postgres'],
 sourceExtensions:[{name:'pgsodium',version:'3.1.9'}],
 availablePgsodium:{name:'pgsodium',installed_version:null},
 availableVersions:['3.1.9'],
 targetExists:false,
};}

test('role preflight performs no DDL when every source role is present',()=>{
 const value=inventory();
 value.destinationRoles=value.sourceRoles.map(role=>role.rolname);
 assert.deepEqual(planRolePreparation(value),{knownMissing:[],unknownCount:0,action:'none'});
});

test('role preflight permits only version-matched pgsodium preparation',()=>{
 const value=inventory();
 const plan=planRolePreparation(value);
 assert.deepEqual(plan,{knownMissing:['pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'],unknownCount:0,action:'install_pgsodium',version:'3.1.9'});
 value.destinationRoles.push(...plan.knownMissing);
 assert.equal(planRolePreparation(value).action,'none');
});

test('role preflight stops for unknown or mixed missing roles',()=>{
 const unknown=inventory();
 unknown.sourceRoles.push({rolname:'unreviewed_role'});
 assert.deepEqual(planRolePreparation(unknown),{knownMissing:['pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'],unknownCount:1,action:'unknown_roles'});
 unknown.destinationRoles.push('pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker');
 assert.deepEqual(planRolePreparation(unknown),{knownMissing:[],unknownCount:1,action:'unknown_roles'});
});

test('role preflight stops for version drift, missing extension, or existing target',()=>{
 const mismatch=inventory();
 mismatch.availableVersions=['3.1.8'];
 assert.equal(planRolePreparation(mismatch).action,'destination_extension_mismatch');
 mismatch.availableVersions=['3.1.9'];
 mismatch.availablePgsodium.installed_version='3.1.9';
 assert.equal(planRolePreparation(mismatch).action,'destination_extension_mismatch');
 const absent=inventory();
 absent.sourceExtensions=[];
 assert.equal(planRolePreparation(absent).action,'source_extension_missing');
 const invalid=inventory();
 invalid.sourceExtensions[0].version="3.1.9'; DROP ROLE postgres; --";
 assert.equal(planRolePreparation(invalid).action,'source_version_invalid');
 const occupied=inventory();
 occupied.targetExists=true;
 assert.equal(planRolePreparation(occupied).action,'target_exists');
});
