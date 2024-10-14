import { logger, timestampInSeconds } from '@sentry/utils';
import { DeviceEventEmitter } from 'react-native';

import { NATIVE } from '../wrapper';
import { NewFrameEventName } from './sentryeventemitter';

export type FallBackNewFrameEvent = { newFrameTimestampInSeconds: number; isFallback?: boolean };
export interface SentryEventEmitterFallback {
  /**
   * Initializes the fallback event emitter
   * This method is synchronous in JS but the event emitter starts asynchronously.
   */
  initAsync: () => void;
  startListenerAsync: () => void;
}

/**
 * Creates emitter that allows to listen to UI Frame events when ready.
 */
export function createSentryFallbackEventEmitter(): SentryEventEmitterFallback {
  let NativeEmitterCalled: boolean = false;
  let isListening = false;

  function defaultFallbackEventEmitter(): void {
    // Schedule the callback to be executed when all UI Frames have flushed.
    requestAnimationFrame(() => {
      if (NativeEmitterCalled) {
        NativeEmitterCalled = false;
        isListening = false;
        return;
      }
      const seconds = timestampInSeconds();
      waitForNativeResponseOrFallback(seconds, 'JavaScript');
    });
  }

  function waitForNativeResponseOrFallback(fallbackSeconds: number, origin: string): void {
    let firstAttemptCompleted = false;

    const checkNativeResponse = (): void => {
      if (NativeEmitterCalled) {
        NativeEmitterCalled = false;
        isListening = false;
        return; // Native Replied the bridge with a timestamp.
      }
      if (!firstAttemptCompleted) {
        firstAttemptCompleted = true;
        setTimeout(checkNativeResponse, 3_000);
      } else {
        logger.log(`[Sentry] Native event emitter did not reply in time. Using ${origin} fallback emitter.`);
        isListening = false;
        DeviceEventEmitter.emit(NewFrameEventName, {
          newFrameTimestampInSeconds: fallbackSeconds,
          isFallback: true,
        });
      }
    };

    // Start the retry process
    checkNativeResponse();
  }

  return {
    initAsync() {
      DeviceEventEmitter.addListener(NewFrameEventName, () => {
        // Avoid noise from pages that we do not want to track.
        if (isListening) {
          NativeEmitterCalled = true;
        }
      });
    },

    startListenerAsync() {
      isListening = true;

      NATIVE.getNewScreenTimeToDisplay()
        .then(resolve => {
          if (resolve) {
            waitForNativeResponseOrFallback(resolve, 'Native');
          } else {
            defaultFallbackEventEmitter();
          }
        })
        .catch((reason: Error) => {
          logger.error('Failed to recceive Native fallback timestamp.', reason);
          defaultFallbackEventEmitter();
        });
    },
  };
}
