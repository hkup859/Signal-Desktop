// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { MessageAttributesType } from '../model-types.d';
import { DAY } from './durations';
import { canEditMessages } from './canEditMessages';
import { isMoreRecentThan } from './timestamp';
import { isOutgoing } from '../messages/helpers';
import { isSent, someSendStatus } from '../messages/MessageSendState';

const MAX_EDIT_COUNT = 10;

export function canEditMessage(message: MessageAttributesType): boolean {
  const result =
    canEditMessages() &&
    !message.deletedForEveryone &&
    isOutgoing(message) &&
    isMoreRecentThan(message.sent_at, DAY) &&
    (message.editHistory?.length ?? 0) <= MAX_EDIT_COUNT &&
    someSendStatus(message.sendStateByConversationId, isSent) &&
    Boolean(message.body);

  if (result) {
    return true;
  }

  if (
    message.conversationId ===
    window.ConversationController.getOurConversationId()
  ) {
    return (
      canEditMessages() && !message.deletedForEveryone && Boolean(message.body)
    );
  }

  return false;
}
