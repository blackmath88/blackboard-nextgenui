import { Effect } from 'effect'
import { Mount } from 'foldkit'
import { Message } from './message.js'

export const FollowChat = Mount.define('FollowChat', {
  messages: [Message.MountedChatScroll],
  execute: ({ element }) => Effect.acquireRelease(
    Effect.sync(() => {
      if (!(element instanceof HTMLElement)) return () => {}
      let following = true
      const track = () => {
        following = element.scrollHeight - element.clientHeight - element.scrollTop < 64
      }
      const follow = () => {
        if (following) element.scrollTop = element.scrollHeight
      }
      const observer = new MutationObserver(follow)
      observer.observe(element, { childList: true, characterData: true, subtree: true })
      element.addEventListener('scroll', track, { passive: true })
      follow()
      return () => {
        observer.disconnect()
        element.removeEventListener('scroll', track)
      }
    }),
    cleanup => Effect.sync(cleanup),
  ).pipe(Effect.as(Message.MountedChatScroll())),
})
