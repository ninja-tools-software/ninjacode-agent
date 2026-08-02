import { AppComposerArea, type AppComposerAreaProps } from "./AppComposerArea.js";
import { AppPanels, type AppPanelsProps } from "./AppPanels.js";

type AppFooterSectionProps = AppPanelsProps & AppComposerAreaProps;

export function AppFooterSection(props: AppFooterSectionProps) {
  return (
    <>
      <AppPanels {...props} />
      <AppComposerArea {...props} />
    </>
  );
}

export { appHasComposerContent, docLength, voicePlaceholder } from "./AppComposerArea.js";
