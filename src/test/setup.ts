import { installResizeObserver } from './resize-observer';

// jsdom implements no ResizeObserver, and the editor measures its stage and
// its popover through one since task 40.
installResizeObserver();
