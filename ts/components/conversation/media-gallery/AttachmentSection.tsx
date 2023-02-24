// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

import type { ItemClickEvent } from './types/ItemClickEvent';
import type { LocalizerType } from '../../../types/Util';
import type { MediaItemType } from '../../../types/MediaItem';
import { DocumentListItem } from './DocumentListItem';
import { MediaGridItem } from './MediaGridItem';
import { getMessageTimestamp } from '../../../util/getMessageTimestamp';
import { missingCaseError } from '../../../util/missingCaseError';

export type Props = {
  header?: string;
  i18n: LocalizerType;
  mediaItems: ReadonlyArray<MediaItemType>;
  onItemClick: (event: ItemClickEvent) => unknown;
  checked: boolean;
  type: 'media' | 'documents';
};

export function AttachmentSection({
  i18n,
  header,
  type,
  mediaItems,
  onItemClick,
  checked,
}: Props): JSX.Element {
  // Recent Media Section - Add ability to select multiple and then select all like android
  return (
    <div className="module-attachment-section">
      <h2 className="module-attachment-section__header">{header}</h2>
      <div className="module-attachment-section__items">
        {mediaItems.map((mediaItem, position, array) => {
          const shouldShowSeparator = position < array.length - 1;
          const { message, index, attachment } = mediaItem;

          const onClick = () => {
            onItemClick({ type, message, attachment });
          };

          switch (type) {
            case 'media':
              return (
                <MediaGridItem
                  key={`${message.id}-${index}`}
                  mediaItem={mediaItem}
                  onClick={onClick}
                  checkmark={checked}
                  i18n={i18n}
                />
              );
            case 'documents':
              return (
                <DocumentListItem
                  key={`${message.id}-${index}`}
                  fileName={attachment.fileName}
                  fileSize={attachment.size}
                  shouldShowSeparator={shouldShowSeparator}
                  onClick={onClick}
                  timestamp={getMessageTimestamp(message)}
                />
              );
            default:
              return missingCaseError(type);
          }
        })}
      </div>
    </div>
  );
}
