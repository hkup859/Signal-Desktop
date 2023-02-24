// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback } from 'react';
import classNames from 'classnames';

import type { ReadonlyDeep } from 'type-fest';
import {
  isImageTypeSupported,
  isVideoTypeSupported,
} from '../../../util/GoogleChrome';
import type { LocalizerType } from '../../../types/Util';
import type { MediaItemType } from '../../../types/MediaItem';
import * as log from '../../../logging/log';

export type Props = {
  mediaItem: ReadonlyDeep<MediaItemType>;
  onClick?: () => void;
  checkmark: boolean;
  i18n: LocalizerType;
};

type State = {
  imageBroken: boolean;
  clickedThing: boolean;
};

export class MediaGridItem extends React.Component<Props, State> {
  private readonly onImageErrorBound: () => void;

  constructor(props: Props) {
    super(props);

    this.state = {
      imageBroken: false,
      clickedThing: false,
    };

    this.onImageErrorBound = this.onImageError.bind(this);
  }

  public onImageError(): void {
    log.info(
      'MediaGridItem: Image failed to load; failing over to placeholder'
    );
    this.setState({
      imageBroken: true,
    });
  }

  public renderContent(): JSX.Element | null {
    const { mediaItem, i18n } = this.props;
    const { imageBroken, clickedThing } = this.state;
    const { attachment, contentType } = mediaItem;

    if (!attachment) {
      return null;
    }

    if (contentType && isImageTypeSupported(contentType)) {
      console.log('TODO4 - TEST 1');
      if (imageBroken || !mediaItem.thumbnailObjectUrl) {
        return (
          <div
            className={classNames(
              'module-media-grid-item__icon',
              'module-media-grid-item__icon-image'
            )}
          />
        );
      }

      return (
        <div className="module-media-grid-item__image-container">
          <img
            alt={i18n('lightboxImageAlt')}
            className="module-media-grid-item__image"
            src={mediaItem.thumbnailObjectUrl}
            onError={this.onImageErrorBound}
          />
          {/* <div className="module-media-grid-item__checkmark_circle_solid" /> */}
          <div
            className={classNames({
              'module-media-grid-item__checkmark_circle_solid': clickedThing,
            })}
          />
        </div>
      );
    }
    if (contentType && isVideoTypeSupported(contentType)) {
      console.log('TODO4 - TEST 2');
      if (imageBroken || !mediaItem.thumbnailObjectUrl) {
        return (
          <div
            className={classNames(
              'module-media-grid-item__icon',
              'module-media-grid-item__icon-video'
            )}
          />
        );
      }

      return (
        <div className="module-media-grid-item__image-container">
          <img
            alt={i18n('lightboxImageAlt')}
            className="module-media-grid-item__image"
            src={mediaItem.thumbnailObjectUrl}
            onError={this.onImageErrorBound}
          />
          <div className="module-media-grid-item__circle-overlay">
            <div className="module-media-grid-item__play-overlay" />
          </div>
        </div>
      );
    }

    console.log('TODO4 - TEST 3');
    return (
      <div>
        className=
        {classNames(
          'module-media-grid-item__icon',
          'module-media-grid-item__icon-generic'
        )}
      </div>
    );
  }

  public override render(): JSX.Element {
    const { onClick, checkmark } = this.props;
    const { clickedThing } = this.state;

    return (
      // <p>WHAT</p>
      <button
        type="button"
        className="module-media-grid-item"
        onClick={() => {
          if (onClick) {
            onClick();
          } else if (checkmark) {
            this.setState({ clickedThing: !clickedThing });
          }
        }}
      >
        {this.renderContent()}
      </button>
    );
  }
}
