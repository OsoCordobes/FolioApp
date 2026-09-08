import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizarFilas,parseCsv,previewFilas,resumirImportacion,normalizarHuellaImportacion} from '../../lib/import/pacientes-csv';
test('preview identifies duplicates on later pages while household contacts stay distinct',()=>{
 const csv=parseCsv('Nombre,Apellido,Telefono,DNI\nSynthetic,One,3515551100,20000000\nSynthetic,Two,3515551100,20000001\nSynthetic,Again,3515551100,20.000.000');
 const rows=previewFilas(normalizarFilas(csv.filas,{nombre:0,apellido:1,telefono:2,dni:3}));assert.deepEqual(rows.map(r=>r.preview),['ready','ready','duplicate_file']);
});
test('normalized row fingerprint ignores phone formatting without identifying by phone alone',()=>{
 const base={nombre:'Synthetic Compound',apellido:'Family',dni:null,telefono:'3515551100',email:null,fechaNacimiento:null,obraSocial:null,nroAfiliado:null};
 assert.deepEqual(normalizarHuellaImportacion(base),normalizarHuellaImportacion({...base,nombre:'Synthetic  Compound',telefono:'+54 9 351 555-1100'}));assert.notDeepEqual(normalizarHuellaImportacion(base),normalizarHuellaImportacion({...base,nombre:'Other Patient'}));
});
test('results show every row including unacknowledged ones, with no inferred success',()=>{
 const result=resumirImportacion('run',25,[{fila:2,status:'imported',code:'created'},{fila:3,status:'review_dni',code:'existing_dni'}]);assert.equal(result.filas.length,25);assert.equal(result.pendientes,23);assert.equal(result.completo,false);assert.equal(result.importados,1);assert.equal(result.duplicadosDni,1);
});

test('an unclosed CSV quote is rejected instead of merging the next patients into one row',()=>{
 const parsed=parseCsv('Nombre,Apellido,Telefono\n"Synthetic,One,3515551100\nSynthetic,Two,3515551100');assert.equal(parsed.error,'El archivo tiene comillas sin cerrar. Corregilo antes de importar.');
});
