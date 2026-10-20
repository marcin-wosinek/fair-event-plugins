/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	Notice,
	PanelBody,
	RangeControl,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';

export const MIN_SESSIONS = 1;
export const MAX_SESSIONS = 20;
export const DEFAULT_SESSIONS = 5;

/**
 * Shown while the server renders the preview.
 *
 * @return {JSX.Element} Loading state.
 */
function LoadingPreview() {
	return (
		<p>
			<Spinner /> { __( 'Loading upcoming sessions…', 'fair-events' ) }
		</p>
	);
}

/**
 * Shown when the preview request fails.
 *
 * @return {JSX.Element} Error state.
 */
function PreviewError() {
	return (
		<Notice status="error" isDismissible={ false }>
			{ __(
				'Could not load the preview of upcoming sessions. Reload the editor to try again.',
				'fair-events'
			) }
		</Notice>
	);
}

/**
 * Shown when the server returns no markup at all.
 *
 * @return {JSX.Element} Empty state.
 */
function EmptyPreview() {
	return (
		<p style={ { fontStyle: 'italic', color: '#757575' } }>
			{ __(
				'Other Sessions block is disabled — no event is linked to this post.',
				'fair-events'
			) }
		</p>
	);
}

/**
 * Edit component for the Other Sessions block.
 *
 * The page's event is resolved by the server render (SelectedOccurrence,
 * the same path visitors get), so the preview and its explanations — no
 * linked event, a non-recurring event, a draft series — come from
 * render.php rather than a copy of that logic here.
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Attribute setter
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { attributes, setAttributes } ) {
	const blockProps = useBlockProps();
	const { maxSessions = DEFAULT_SESSIONS } = attributes;

	return (
		<div { ...blockProps }>
			<InspectorControls>
				<PanelBody title={ __( 'Settings', 'fair-events' ) }>
					<RangeControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Maximum sessions', 'fair-events' ) }
						help={ __(
							'How many upcoming sessions to list, soonest first.',
							'fair-events'
						) }
						value={ maxSessions }
						min={ MIN_SESSIONS }
						max={ MAX_SESSIONS }
						onChange={ ( value ) =>
							setAttributes( {
								maxSessions: Math.min(
									MAX_SESSIONS,
									Math.max(
										MIN_SESSIONS,
										parseInt( value, 10 ) ||
											DEFAULT_SESSIONS
									)
								),
							} )
						}
					/>
				</PanelBody>
			</InspectorControls>
			<ServerSideRender
				block="fair-events/other-sessions"
				attributes={ attributes }
				LoadingResponsePlaceholder={ LoadingPreview }
				ErrorResponsePlaceholder={ PreviewError }
				EmptyResponsePlaceholder={ EmptyPreview }
			/>
		</div>
	);
}
