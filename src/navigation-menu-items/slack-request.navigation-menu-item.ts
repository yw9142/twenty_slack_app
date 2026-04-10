import { NavigationMenuItemType, defineNavigationMenuItem } from 'twenty-sdk';

import {
  SLACK_REQUEST_NAVIGATION_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: SLACK_REQUEST_NAVIGATION_UNIVERSAL_IDENTIFIER,
  name: 'slack-request-navigation-menu-item',
  icon: 'IconBrandSlack',
  color: 'blue',
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
});
