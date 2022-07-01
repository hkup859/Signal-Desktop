// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import FocusTrap from 'focus-trap-react';
import React, { useCallback, useState } from 'react';
import classNames from 'classnames';
import type {
  ConversationType,
  ShowConversationType,
} from '../state/ducks/conversations';
import type {
  ConversationStoryType,
  MyStoryType,
  StoryViewType,
} from '../types/Stories';
import type { LocalizerType } from '../types/Util';
import type { PropsType as SmartStoryCreatorPropsType } from '../state/smart/StoryCreator';
import type { PropsType as SmartStoryViewerPropsType } from '../state/smart/StoryViewer';
import * as log from '../logging/log';
import { MyStories } from './MyStories';
import { StoriesPane } from './StoriesPane';
import { Theme, themeClassName } from '../util/theme';
import { getWidthFromPreferredWidth } from '../util/leftPaneWidth';

export type PropsType = {
  deleteStoryForEveryone: (story: StoryViewType) => unknown;
  hiddenStories: Array<ConversationStoryType>;
  i18n: LocalizerType;
  me: ConversationType;
  myStories: Array<MyStoryType>;
  onForwardStory: (storyId: string) => unknown;
  onSaveStory: (story: StoryViewType) => unknown;
  ourConversationId: string;
  preferredWidthFromStorage: number;
  queueStoryDownload: (storyId: string) => unknown;
  renderStoryCreator: (props: SmartStoryCreatorPropsType) => JSX.Element;
  renderStoryViewer: (props: SmartStoryViewerPropsType) => JSX.Element;
  showConversation: ShowConversationType;
  stories: Array<ConversationStoryType>;
  toggleHideStories: (conversationId: string) => unknown;
  toggleStoriesView: () => unknown;
};

export const Stories = ({
  deleteStoryForEveryone,
  hiddenStories,
  i18n,
  me,
  myStories,
  onForwardStory,
  onSaveStory,
  ourConversationId,
  preferredWidthFromStorage,
  queueStoryDownload,
  renderStoryCreator,
  renderStoryViewer,
  showConversation,
  stories,
  toggleHideStories,
  toggleStoriesView,
}: PropsType): JSX.Element => {
  const [conversationIdToView, setConversationIdToView] = useState<
    undefined | string
  >();

  const width = getWidthFromPreferredWidth(preferredWidthFromStorage, {
    requiresFullWidth: true,
  });

  const onNextUserStories = useCallback(() => {
    // First find the next unread story if there are any
    const nextUnreadIndex = stories.findIndex(conversationStory =>
      conversationStory.stories.some(story => story.isUnread)
    );

    log.info('stories.onNextUserStories', { nextUnreadIndex });

    if (nextUnreadIndex >= 0) {
      const nextStory = stories[nextUnreadIndex];
      setConversationIdToView(nextStory.conversationId);
      return;
    }

    // If not then play the next available story
    const storyIndex = stories.findIndex(
      x => x.conversationId === conversationIdToView
    );

    log.info('stories.onNextUserStories', {
      storyIndex,
      length: stories.length,
    });

    // If we've reached the end, close the viewer
    if (storyIndex >= stories.length - 1 || storyIndex === -1) {
      setConversationIdToView(undefined);
      return;
    }
    const nextStory = stories[storyIndex + 1];
    setConversationIdToView(nextStory.conversationId);
  }, [conversationIdToView, stories]);

  const onPrevUserStories = useCallback(() => {
    const storyIndex = stories.findIndex(
      x => x.conversationId === conversationIdToView
    );

    log.info('stories.onPrevUserStories', {
      storyIndex,
      length: stories.length,
    });

    if (storyIndex <= 0) {
      // Restart playback on the story if it's the oldest
      setConversationIdToView(conversationIdToView);
      return;
    }
    const prevStory = stories[storyIndex - 1];
    setConversationIdToView(prevStory.conversationId);
  }, [conversationIdToView, stories]);

  const [isShowingStoryCreator, setIsShowingStoryCreator] = useState(false);
  const [isMyStories, setIsMyStories] = useState(false);

  return (
    <div className={classNames('Stories', themeClassName(Theme.Dark))}>
      {isShowingStoryCreator &&
        renderStoryCreator({
          onClose: () => setIsShowingStoryCreator(false),
        })}
      {conversationIdToView &&
        renderStoryViewer({
          conversationId: conversationIdToView,
          onClose: () => setConversationIdToView(undefined),
          onNextUserStories,
          onPrevUserStories,
        })}
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
        <div className="Stories__pane" style={{ width }}>
          {isMyStories && myStories.length ? (
            <MyStories
              i18n={i18n}
              myStories={myStories}
              onBack={() => setIsMyStories(false)}
              onDelete={deleteStoryForEveryone}
              onForward={onForwardStory}
              onSave={onSaveStory}
              ourConversationId={ourConversationId}
              queueStoryDownload={queueStoryDownload}
              renderStoryViewer={renderStoryViewer}
            />
          ) : (
            <StoriesPane
              hiddenStories={hiddenStories}
              i18n={i18n}
              me={me}
              myStories={myStories}
              onAddStory={() => setIsShowingStoryCreator(true)}
              onMyStoriesClicked={() => {
                if (myStories.length) {
                  setIsMyStories(true);
                } else {
                  setIsShowingStoryCreator(true);
                }
              }}
              onStoryClicked={clickedIdToView => {
                const storyIndex = stories.findIndex(
                  x => x.conversationId === clickedIdToView
                );
                log.info('stories.onStoryClicked[StoriesPane]', {
                  storyIndex,
                  length: stories.length,
                });
                setConversationIdToView(clickedIdToView);
              }}
              queueStoryDownload={queueStoryDownload}
              showConversation={showConversation}
              stories={stories}
              toggleHideStories={toggleHideStories}
              toggleStoriesView={toggleStoriesView}
            />
          )}
        </div>
      </FocusTrap>
      <div className="Stories__placeholder">
        <div className="Stories__placeholder__stories" />
        {i18n('Stories__placeholder--text')}
      </div>
    </div>
  );
};
