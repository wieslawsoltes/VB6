/** Shared IDE entry points for built-in control designer editors. Custom OCX
 * property pages continue through the trusted adapter registry unchanged. */
import {clone, lower} from '../core/core.js';
import {editDesignerProperties} from '../designer/property-model.js';
import {controlParents, materializeTabPages} from '../controls/tab-model.js';
import {renameSymbol} from '../editor/language-service.js';
import {moduleLanguage} from '../project/language.js';
import {sstabPropertyPages} from './designer-property-pages.js';
import {alertDialog} from './ui.js';

export function captureDesignerEdit(ide) {
  const project = ide.project, module = ide.activeModule, form = module?.form;
  const snapshot = JSON.stringify(form), ids = ide.designer.selected().map(c => c.id).join('\n');
  return () => {
    if (ide.runState !== 'design' || ide.designer.locked || ide.project !== project || ide.activeModule !== module || JSON.stringify(module?.form) !== snapshot || ide.designer.selected().map(c => c.id).join('\n') !== ids) {
      throw new Error('The form or selection changed while the editor was open. Reopen it before applying.');
    }
  };
}

/** Rename all members of a control array together. Exact parent identities and
 * materialized page bindings prevent moving children of a different element. */
export function renamedDesignerForm(form, id, name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.length > 40) throw new Error('Use a letter followed by letters, numbers or underscores (maximum 40 characters).');
  const next = clone(form), target = next.controls.find(c => c.id === id);
  if (!target) throw new Error('Control not found.');
  const group = next.controls.filter(c => lower(c.name) === lower(target.name)), ids = new Set(group.map(c => c.id));
  if (lower(next.name) === lower(name) || next.menus.some(c => lower(c.name) === lower(name))) throw new Error('A form or menu already uses that name.');
  const conflicts = next.controls.filter(c => !ids.has(c.id) && lower(c.name) === lower(name));
  if (conflicts.some(c => group.some(g => c.type !== g.type || c.properties.Index === undefined || g.properties.Index === undefined || Number(c.properties.Index) === Number(g.properties.Index)))) throw new Error('Duplicate or incompatible control name and Index.');
  materializeTabPages(next); const parents = controlParents(next);
  for (const c of next.controls) if (ids.has(parents.get(c.id)?.id)) c.parent = name;
  for (const c of group) {c.name = name; c.properties.Name = name;}
  return next;
}

export function installDesignerEditors(ide) {
  const one = ide.setProperty.bind(ide), many = ide.setProperties.bind(ide);
  const pages = ide.showControlPropertyPages.bind(ide), menu = ide.designerMenu.bind(ide), command = ide.command.bind(ide);
  const apply = changes => {
    if (ide.runState !== 'design' || !ide.activeModule?.form) return false;
    const selected = ide.designer.selected(); if (!selected.length) return false;
    const next = editDesignerProperties(ide.activeModule.form, selected.map(c => c.id), changes);
    if (!next) return false;
    for (const c of selected) ide.controlRegistry?.validateProperties?.(c.type, changes);
    ide.designer.transaction('Set ' + Object.keys(changes).join(', '), () => {ide.activeModule.form = next;});
    ide.designer.render(); return true;
  };
  ide.setProperties = changes => {
    if (ide.activeModule?.form && ide.designer.locked) throw new Error('Unlock controls before editing properties.');
    if (Object.hasOwn(changes, 'Name')) {
      if (Object.keys(changes).length !== 1) throw new Error('Rename separately from other property changes.');
      return ide.setProperty('Name', changes.Name);
    }
    return apply(changes) || many(changes);
  };
  ide.setProperty = (key, value) => {
    if (ide.activeModule?.form && ide.designer.locked) throw new Error('Unlock controls before editing properties.');
    const selected = ide.designer.selected();
    if (key === 'Name' && ide.runState === 'design' && ide.activeModule?.form && selected.length) {
      if (selected.length !== 1) throw new Error('Select one control or array element to rename.');
      const next = renamedDesignerForm(ide.activeModule.form, selected[0].id, value), old = selected[0].name;
      if (JSON.stringify(next) === JSON.stringify(ide.activeModule.form)) return;
      const before = clone(ide.project); ide.activeModule.form = next;
      for (const module of ide.project.modules) module.code = renameSymbol(module.code, old, value,{language:moduleLanguage(module,ide.project)});
      ide.record(before, 'Rename ' + old); return;
    }
    return apply({[key]: value}) || one(key, value);
  };
  ide.canEditDesignerSelection = selected => selected.length === 1 && selected[0].type === 'SSTab';
  ide.showControlPropertyPages = () => {
    if (ide.designer.locked) return Promise.reject(new Error('Unlock controls before editing properties.'));
    if (ide.runState !== 'design') return Promise.reject(new Error('Stop execution before editing component properties.'));
    const selected = ide.designer.selected();
    return ide.canEditDesignerSelection(selected) ? sstabPropertyPages(ide, selected[0]) : pages();
  };
  ide.designerMenu = () => {
    const items = menu(), selected = ide.designer.selected();
    if (ide.canEditDesignerSelection(selected) || ide.controlRegistry?.canEditSelection?.(selected)) items.splice(3, 0, {label: 'Property Pages…', id: 'designerPropertyPages', enabled: ide.runState === 'design' && !ide.designer.locked});
    return items;
  };
  ide.command = async (id, ...args) => {
    if (id !== 'designerPropertyPages') return command(id, ...args);
    try {return await ide.showControlPropertyPages();} catch (error) {await alertDialog(error.message, 'Component Properties'); return false;}
  };
}
