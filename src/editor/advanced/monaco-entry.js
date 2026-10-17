import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import {MonospaceLineBreaksComputerFactory} from 'monaco-editor/editor/common/viewModel/monospaceLineBreaksComputer';
import {CursorColumns} from 'monaco-editor/editor/common/core/cursorColumns';
import {createVimLineLayout as createLayout} from './vim-line-layout.js';
export const createVimLineLayout=view=>createLayout(view,monaco,MonospaceLineBreaksComputerFactory,CursorColumns);
export {monaco};
