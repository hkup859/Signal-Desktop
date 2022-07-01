// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThunkAction } from 'redux-thunk';
import { isEqual, pick } from 'lodash';
import type { AttachmentType } from '../../types/Attachment';
import type { BodyRangeType } from '../../types/Util';
import type { MessageAttributesType } from '../../model-types.d';
import type {
  MessageChangedActionType,
  MessageDeletedActionType,
} from './conversations';
import type { NoopActionType } from './noop';
import type { StateType as RootStateType } from '../reducer';
import type { StoryViewType } from '../../types/Stories';
import type { SyncType } from '../../jobs/helpers/syncHelpers';
import * as log from '../../logging/log';
import dataInterface from '../../sql/Client';
import { DAY } from '../../util/durations';
import { ReadStatus } from '../../messages/MessageReadStatus';
import { ToastReactionFailed } from '../../components/ToastReactionFailed';
import { UUID } from '../../types/UUID';
import { enqueueReactionForSend } from '../../reactions/enqueueReactionForSend';
import { getMessageById } from '../../messages/getMessageById';
import { markViewed } from '../../services/MessageUpdater';
import { queueAttachmentDownloads } from '../../util/queueAttachmentDownloads';
import { replaceIndex } from '../../util/replaceIndex';
import { sendDeleteForEveryoneMessage } from '../../util/sendDeleteForEveryoneMessage';
import { showToast } from '../../util/showToast';
import {
  hasNotResolved,
  isDownloaded,
  isDownloading,
} from '../../types/Attachment';
import { useBoundActions } from '../../hooks/useBoundActions';
import { viewSyncJobQueue } from '../../jobs/viewSyncJobQueue';
import { viewedReceiptsJobQueue } from '../../jobs/viewedReceiptsJobQueue';
import { isGroup } from '../../util/whatTypeOfConversation';
import { getConversationSelector } from '../selectors/conversations';

export type StoryDataType = {
  attachment?: AttachmentType;
  messageId: string;
} & Pick<
  MessageAttributesType,
  | 'canReplyToStory'
  | 'conversationId'
  | 'deletedForEveryone'
  | 'reactions'
  | 'readStatus'
  | 'sendStateByConversationId'
  | 'source'
  | 'sourceUuid'
  | 'storyDistributionListId'
  | 'timestamp'
  | 'type'
>;

// State

export type StoriesStateType = {
  readonly isShowingStoriesView: boolean;
  readonly replyState?: {
    messageId: string;
    replies: Array<MessageAttributesType>;
  };
  readonly stories: Array<StoryDataType>;
};

// Actions

const DOE_STORY = 'stories/DOE';
const LOAD_STORY_REPLIES = 'stories/LOAD_STORY_REPLIES';
const MARK_STORY_READ = 'stories/MARK_STORY_READ';
const REPLY_TO_STORY = 'stories/REPLY_TO_STORY';
export const RESOLVE_ATTACHMENT_URL = 'stories/RESOLVE_ATTACHMENT_URL';
const STORY_CHANGED = 'stories/STORY_CHANGED';
const TOGGLE_VIEW = 'stories/TOGGLE_VIEW';

type DOEStoryActionType = {
  type: typeof DOE_STORY;
  payload: string;
};

type LoadStoryRepliesActionType = {
  type: typeof LOAD_STORY_REPLIES;
  payload: {
    messageId: string;
    replies: Array<MessageAttributesType>;
  };
};

type MarkStoryReadActionType = {
  type: typeof MARK_STORY_READ;
  payload: string;
};

type ReplyToStoryActionType = {
  type: typeof REPLY_TO_STORY;
  payload: MessageAttributesType;
};

type ResolveAttachmentUrlActionType = {
  type: typeof RESOLVE_ATTACHMENT_URL;
  payload: {
    messageId: string;
    attachmentUrl: string;
  };
};

type StoryChangedActionType = {
  type: typeof STORY_CHANGED;
  payload: StoryDataType;
};

type ToggleViewActionType = {
  type: typeof TOGGLE_VIEW;
};

export type StoriesActionType =
  | DOEStoryActionType
  | LoadStoryRepliesActionType
  | MarkStoryReadActionType
  | MessageChangedActionType
  | MessageDeletedActionType
  | ReplyToStoryActionType
  | ResolveAttachmentUrlActionType
  | StoryChangedActionType
  | ToggleViewActionType;

// Action Creators

export const actions = {
  deleteStoryForEveryone,
  loadStoryReplies,
  markStoryRead,
  queueStoryDownload,
  reactToStory,
  replyToStory,
  storyChanged,
  toggleStoriesView,
};

export const useStoriesActions = (): typeof actions => useBoundActions(actions);

function deleteStoryForEveryone(
  story: StoryViewType
): ThunkAction<void, RootStateType, unknown, DOEStoryActionType> {
  return (dispatch, getState) => {
    if (!story.sendState) {
      return;
    }

    const conversationIds = new Set(
      story.sendState.map(({ recipient }) => recipient.id)
    );

    // Find stories that were sent to other distribution lists so that we don't
    // send a DOE request to the members of those lists.
    const { stories } = getState().stories;
    stories.forEach(item => {
      if (item.timestamp !== story.timestamp) {
        return;
      }

      if (!item.sendStateByConversationId) {
        return;
      }

      Object.keys(item.sendStateByConversationId).forEach(conversationId => {
        conversationIds.delete(conversationId);
      });
    });

    conversationIds.forEach(cid => {
      const conversation = window.ConversationController.get(cid);

      if (!conversation) {
        return;
      }

      sendDeleteForEveryoneMessage(conversation.attributes, {
        deleteForEveryoneDuration: DAY,
        id: story.messageId,
        timestamp: story.timestamp,
      });
    });

    dispatch({
      type: DOE_STORY,
      payload: story.messageId,
    });
  };
}

function loadStoryReplies(
  conversationId: string,
  messageId: string
): ThunkAction<void, RootStateType, unknown, LoadStoryRepliesActionType> {
  return async (dispatch, getState) => {
    const conversation = getConversationSelector(getState())(conversationId);
    const replies = await dataInterface.getOlderMessagesByConversation(
      conversationId,
      { limit: 9000, storyId: messageId, isGroup: isGroup(conversation) }
    );

    dispatch({
      type: LOAD_STORY_REPLIES,
      payload: {
        messageId,
        replies,
      },
    });
  };
}

function markStoryRead(
  messageId: string
): ThunkAction<void, RootStateType, unknown, MarkStoryReadActionType> {
  return async (dispatch, getState) => {
    const { stories } = getState().stories;

    const matchingStory = stories.find(story => story.messageId === messageId);

    if (!matchingStory) {
      log.warn(`markStoryRead: no matching story found: ${messageId}`);
      return;
    }

    if (!isDownloaded(matchingStory.attachment)) {
      return;
    }

    if (matchingStory.readStatus !== ReadStatus.Unread) {
      return;
    }

    const message = await getMessageById(messageId);

    if (!message) {
      return;
    }

    const storyReadDate = Date.now();

    markViewed(message.attributes, storyReadDate);

    const viewedReceipt = {
      messageId,
      senderE164: message.attributes.source,
      senderUuid: message.attributes.sourceUuid,
      timestamp: message.attributes.sent_at,
    };
    const viewSyncs: Array<SyncType> = [viewedReceipt];

    if (!window.ConversationController.areWePrimaryDevice()) {
      viewSyncJobQueue.add({ viewSyncs });
    }

    viewedReceiptsJobQueue.add({ viewedReceipt });

    await dataInterface.addNewStoryRead({
      authorId: message.attributes.sourceUuid,
      conversationId: message.attributes.conversationId,
      storyId: UUID.fromString(messageId),
      storyReadDate,
    });

    dispatch({
      type: MARK_STORY_READ,
      payload: messageId,
    });
  };
}

function queueStoryDownload(
  storyId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  NoopActionType | ResolveAttachmentUrlActionType
> {
  return async (dispatch, getState) => {
    const { stories } = getState().stories;
    const story = stories.find(item => item.messageId === storyId);

    if (!story) {
      return;
    }

    const { attachment } = story;

    if (!attachment) {
      log.warn('queueStoryDownload: No attachment found for story', {
        storyId,
      });
      return;
    }

    if (isDownloaded(attachment)) {
      if (!attachment.path) {
        return;
      }

      // This function also resolves the attachment's URL in case we've already
      // downloaded the attachment but haven't pointed its path to an absolute
      // location on disk.
      if (hasNotResolved(attachment)) {
        dispatch({
          type: RESOLVE_ATTACHMENT_URL,
          payload: {
            messageId: storyId,
            attachmentUrl: window.Signal.Migrations.getAbsoluteAttachmentPath(
              attachment.path
            ),
          },
        });
      }

      return;
    }

    if (isDownloading(attachment)) {
      return;
    }

    const message = await getMessageById(storyId);

    if (message) {
      // We want to ensure that we re-hydrate the story reply context with the
      // completed attachment download.
      message.set({ storyReplyContext: undefined });

      await queueAttachmentDownloads(message.attributes);
    }

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function reactToStory(
  nextReaction: string,
  messageId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    try {
      await enqueueReactionForSend({
        messageId,
        emoji: nextReaction,
        remove: false,
      });
    } catch (error) {
      log.error('Error enqueuing reaction', error, messageId, nextReaction);
      showToast(ToastReactionFailed);
    }

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function replyToStory(
  conversationId: string,
  messageBody: string,
  mentions: Array<BodyRangeType>,
  timestamp: number,
  story: StoryViewType
): ThunkAction<void, RootStateType, unknown, ReplyToStoryActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);

    if (!conversation) {
      log.error('replyToStory: conversation does not exist', conversationId);
      return;
    }

    const messageAttributes = await conversation.enqueueMessageForSend(
      {
        body: messageBody,
        attachments: [],
        mentions,
      },
      {
        storyId: story.messageId,
        timestamp,
      }
    );

    if (messageAttributes) {
      dispatch({
        type: REPLY_TO_STORY,
        payload: messageAttributes,
      });
    }
  };
}

function storyChanged(story: StoryDataType): StoryChangedActionType {
  return {
    type: STORY_CHANGED,
    payload: story,
  };
}

function toggleStoriesView(): ToggleViewActionType {
  return {
    type: TOGGLE_VIEW,
  };
}

// Reducer

export function getEmptyState(
  overrideState: Partial<StoriesStateType> = {}
): StoriesStateType {
  return {
    isShowingStoriesView: false,
    stories: [],
    ...overrideState,
  };
}

export function reducer(
  state: Readonly<StoriesStateType> = getEmptyState(),
  action: Readonly<StoriesActionType>
): StoriesStateType {
  if (action.type === TOGGLE_VIEW) {
    return {
      ...state,
      isShowingStoriesView: !state.isShowingStoriesView,
    };
  }

  if (action.type === 'MESSAGE_DELETED') {
    const nextStories = state.stories.filter(
      story => story.messageId !== action.payload.id
    );

    if (nextStories.length === state.stories.length) {
      return state;
    }

    return {
      ...state,
      stories: nextStories,
    };
  }

  if (action.type === STORY_CHANGED) {
    const newStory = pick(action.payload, [
      'attachment',
      'canReplyToStory',
      'conversationId',
      'deletedForEveryone',
      'messageId',
      'reactions',
      'readStatus',
      'sendStateByConversationId',
      'source',
      'sourceUuid',
      'storyDistributionListId',
      'timestamp',
      'type',
    ]);

    const prevStoryIndex = state.stories.findIndex(
      existingStory => existingStory.messageId === newStory.messageId
    );
    if (prevStoryIndex >= 0) {
      const prevStory = state.stories[prevStoryIndex];

      // Stories rarely need to change, here are the following exceptions:
      const isDownloadingAttachment = isDownloading(newStory.attachment);
      const hasAttachmentDownloaded =
        !isDownloaded(prevStory.attachment) &&
        isDownloaded(newStory.attachment);
      const readStatusChanged = prevStory.readStatus !== newStory.readStatus;
      const reactionsChanged =
        prevStory.reactions?.length !== newStory.reactions?.length;
      const hasBeenDeleted =
        !prevStory.deletedForEveryone && newStory.deletedForEveryone;
      const hasSendStateChanged = !isEqual(
        prevStory.sendStateByConversationId,
        newStory.sendStateByConversationId
      );

      const shouldReplace =
        isDownloadingAttachment ||
        hasAttachmentDownloaded ||
        hasBeenDeleted ||
        hasSendStateChanged ||
        readStatusChanged ||
        reactionsChanged;
      if (!shouldReplace) {
        return state;
      }

      return {
        ...state,
        stories: replaceIndex(state.stories, prevStoryIndex, newStory),
      };
    }

    // Adding a new story
    const stories = [...state.stories, newStory].sort((a, b) =>
      a.timestamp > b.timestamp ? 1 : -1
    );

    return {
      ...state,
      stories,
    };
  }

  if (action.type === MARK_STORY_READ) {
    return {
      ...state,
      stories: state.stories.map(story => {
        if (story.messageId === action.payload) {
          return {
            ...story,
            readStatus: ReadStatus.Viewed,
          };
        }

        return story;
      }),
    };
  }

  if (action.type === LOAD_STORY_REPLIES) {
    return {
      ...state,
      replyState: action.payload,
    };
  }

  // For live updating of the story replies
  if (
    action.type === 'MESSAGE_CHANGED' &&
    state.replyState &&
    state.replyState.messageId === action.payload.data.storyId
  ) {
    const { replyState } = state;
    const messageIndex = replyState.replies.findIndex(
      reply => reply.id === action.payload.id
    );

    // New message
    if (messageIndex < 0) {
      return {
        ...state,
        replyState: {
          messageId: replyState.messageId,
          replies: [...replyState.replies, action.payload.data],
        },
      };
    }

    // Changed message, also handles DOE
    return {
      ...state,
      replyState: {
        messageId: replyState.messageId,
        replies: replaceIndex(
          replyState.replies,
          messageIndex,
          action.payload.data
        ),
      },
    };
  }

  if (action.type === REPLY_TO_STORY) {
    const { replyState } = state;
    if (!replyState) {
      return state;
    }

    return {
      ...state,
      replyState: {
        messageId: replyState.messageId,
        replies: [...replyState.replies, action.payload],
      },
    };
  }

  if (action.type === RESOLVE_ATTACHMENT_URL) {
    const { messageId, attachmentUrl } = action.payload;

    const storyIndex = state.stories.findIndex(
      existingStory => existingStory.messageId === messageId
    );

    if (storyIndex < 0) {
      return state;
    }

    const story = state.stories[storyIndex];

    if (!story.attachment) {
      return state;
    }

    const storyWithResolvedAttachment = {
      ...story,
      attachment: {
        ...story.attachment,
        url: attachmentUrl,
      },
    };

    return {
      ...state,
      stories: replaceIndex(
        state.stories,
        storyIndex,
        storyWithResolvedAttachment
      ),
    };
  }

  if (action.type === DOE_STORY) {
    const prevStoryIndex = state.stories.findIndex(
      existingStory => existingStory.messageId === action.payload
    );

    if (prevStoryIndex < 0) {
      return state;
    }

    return {
      ...state,
      stories: replaceIndex(state.stories, prevStoryIndex, {
        ...state.stories[prevStoryIndex],
        deletedForEveryone: true,
      }),
    };
  }

  return state;
}
