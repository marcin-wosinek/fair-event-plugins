/**
 * Rightmost Actions cell: one frequent text action plus an always-visible
 * overflow menu for secondary actions. The menu is omitted when there are no
 * secondary actions. Each action's behaviour (confirmation, request, state)
 * stays with the page.
 *
 * @package FairEventsShared
 */

import { useId, useRef } from '@wordpress/element';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	NavigableMenu,
} from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';

/**
 * @typedef {Object} RowAction
 * @property {string}   label          Visible action text, e.g. "Edit".
 * @property {string}   accessibleLabel Primary only: item-specific accessible
 *                                      name that starts with `label`, e.g.
 *                                      "Edit “Spring feed”".
 * @property {Function} onClick        Called with { restoreFocus } (see README).
 * @property {string}   href           Link target instead of onClick.
 * @property {boolean}  disabled       Action unavailable.
 * @property {string}   disabledReason Why it is unavailable; shown with it.
 * @property {boolean}  isBusy         Primary only: request running.
 * @property {string}   busyLabel      Primary only: text while busy, e.g. "Sending…".
 * @property {boolean}  isDestructive  Secondary only: destructive styling.
 */

/**
 * @param {Object}      props
 * @param {RowAction}   props.primary   The frequent action.
 * @param {RowAction[]} props.secondary Overflow menu actions.
 * @param {string}      props.moreLabel Item-specific menu trigger name,
 *                                      e.g. "More actions for “Spring feed”".
 * @return {JSX.Element} The actions.
 */
export default function RowActions( { primary, secondary = [], moreLabel } ) {
	const toggleRef = useRef( null );
	const reasonId = useId();
	const restoreFocus = () => toggleRef.current?.focus();
	const primaryReason =
		primary?.disabled && primary.disabledReason
			? primary.disabledReason
			: null;

	return (
		<div className="fair-admin-table__actions">
			<div className="fair-admin-table__action-buttons">
				{ primary && (
					<Button
						variant="link"
						className="fair-admin-table__primary-action"
						href={
							primary.disabled || primary.isBusy
								? undefined
								: primary.href
						}
						onClick={
							primary.disabled || primary.isBusy || primary.href
								? undefined
								: () => primary.onClick?.( { restoreFocus } )
						}
						disabled={ primary.disabled || primary.isBusy }
						accessibleWhenDisabled
						isBusy={ primary.isBusy }
						aria-label={ primary.accessibleLabel || undefined }
						aria-describedby={
							primaryReason ? reasonId : undefined
						}
					>
						{ primary.isBusy && primary.busyLabel
							? primary.busyLabel
							: primary.label }
					</Button>
				) }
				{ secondary.length > 0 && (
					<Dropdown
						className="fair-admin-table__more"
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<Button
								ref={ toggleRef }
								size="small"
								icon={ moreVertical }
								label={ moreLabel }
								aria-haspopup="true"
								aria-expanded={ isOpen }
								onClick={ onToggle }
							/>
						) }
						renderContent={ ( { onClose } ) => (
							<NavigableMenu role="menu" aria-label={ moreLabel }>
								<MenuGroup>
									{ secondary.map( ( action ) => (
										<MenuItem
											key={ action.label }
											href={
												action.disabled
													? undefined
													: action.href
											}
											isDestructive={
												action.isDestructive
											}
											disabled={ action.disabled }
											info={
												action.disabled
													? action.disabledReason
													: undefined
											}
											onClick={ () => {
												if ( action.disabled ) {
													return;
												}
												onClose();
												restoreFocus();
												action.onClick?.( {
													restoreFocus,
												} );
											} }
										>
											{ action.label }
										</MenuItem>
									) ) }
								</MenuGroup>
							</NavigableMenu>
						) }
					/>
				) }
			</div>
			{ primaryReason && (
				<span id={ reasonId } className="fair-admin-table__reason">
					{ primaryReason }
				</span>
			) }
		</div>
	);
}
