import {installDesignerLayout as installBaseDesignerLayout} from './canvas-tools-base.js';
import {prepareAdvancedDesignerLayout} from './canvas-tools-advanced.js';

/**
 * Compose the classic designer gestures with the optional advanced grid and
 * masonry authoring layer. The base controller remains independently usable;
 * the advanced layer owns only grid-specific painting and input interception.
 */
export function installDesignerLayout(designer,ui){
  if(designer.advancedAutoLayoutTools)return designer.autoLayoutTools;
  const finish=prepareAdvancedDesignerLayout(designer,ui);
  const tools=installBaseDesignerLayout(designer,ui);
  finish(tools);
  return tools;
}
