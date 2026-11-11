/** Popups, which take the keyboard while they show: dialogs, menus and a dropdown's list */
export const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * Whether a popup is showing, so the app's shortcuts stand aside: one matching `selector` (any popup by default) other
 * than `except`, and not hidden. Base UI leaves a dropdown's list in the page, hidden, once its trigger has had the
 * keyboard, so counting every one in the page (as until 11 November) left the editor's keys dead after any dropdown
 * had been used, until the panel holding it closed
 */
export function popupOpen(selector = POPUPS, except?: Element | null) {
  return [...document.querySelectorAll(selector)].some((element) => element !== except && !element.closest('[hidden]'))
}
