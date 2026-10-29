/**
 * Event Signup Block - Editor Component
 *
 * Canonical fair-events signup block. Renders the anonymous get-tickets form;
 * when fair-audience is active it enriches the same render via render-context
 * filters and render slots instead of a competing template — so the editor
 * preview (ServerSideRender of this same block) always reflects it, in both
 * configurations.
 *
 * The legacy fair-audience/event-signup and fair-events/get-tickets blocks
 * hide themselves from the inserter and register their own transforms to
 * this block.
 *
 * @package FairEvents
 */

import { registerBlockType } from '@wordpress/blocks';
import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import {
	ExternalLink,
	PanelBody,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { createPortal, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import {
	FAIR_FORM_BLOCK_NAMESPACE,
	LEGACY_FAIR_FORM_BLOCK_NAMESPACE,
} from 'fair-events-shared/src/question-utils.js';
import metadata from './block.json';
import './editor.css';

const UNIFIED_NAME = 'fair-events/event-signup';

// Where render.php puts an empty slot (instead of the real nested content)
// when isEditorPreview is set, so the editor can portal the editable "Form
// content" area into the same on-screen position as the frontend.
const QUESTIONS_SLOT_SELECTOR = '.fair-events-event-signup-questions-slot';

// Blocks always allowed in the form content area, regardless of fair-form.
const BASE_ALLOWED_BLOCKS = [ 'core/heading', 'core/paragraph', 'core/list' ];

// Custom question blocks that can additionally be nested once fair-form is
// active, by slug (the namespace depends on the Fair Form version). Mirrors
// the legacy fair-audience/event-signup block's set, minus the file-upload
// question: the unified form is submittable by anonymous visitors and
// uploads stay out until there is a vetted path.
const FAIR_FORM_ALLOWED_BLOCK_SLUGS = [
	'fair-form-short-text',
	'fair-form-long-text',
	'fair-form-email',
	'fair-form-phone',
	'fair-form-url',
	'fair-form-date',
	'fair-form-datetime',
	'fair-form-select-one',
	'fair-form-radio',
	'fair-form-multiselect',
	'fair-form-consent',
	'fair-form-conditional',
];

registerBlockType( metadata.name, {
	...metadata,
	edit: function Edit( { attributes, setAttributes } ) {
		const blockProps = useBlockProps();

		// The fair-form question set is only registered when fair-form is
		// active. Without it, offer no question blocks — there is no
		// fair-events-owned default question set. Fair Form registers its
		// blocks under its own namespace since #1161 (keeping the
		// fair-audience names as hidden aliases); older versions only have
		// the fair-audience names, so fall back to those.
		const fairFormNamespace = useSelect(
			( select ) =>
				[
					FAIR_FORM_BLOCK_NAMESPACE,
					LEGACY_FAIR_FORM_BLOCK_NAMESPACE,
				].find(
					( namespace ) =>
						!! select( 'core/blocks' ).getBlockType(
							`${ namespace }/fair-form-short-text`
						)
				) ?? null,
			[]
		);

		const allowedBlocks = fairFormNamespace
			? [
					...BASE_ALLOWED_BLOCKS,
					...FAIR_FORM_ALLOWED_BLOCK_SLUGS.map(
						( slug ) => `${ fairFormNamespace }/${ slug }`
					),
				]
			: BASE_ALLOWED_BLOCKS;

		const {
			postEventDateId = 0,
			manageEventUrl = '',
			ticketingEnabled = false,
			canManageEvents = false,
		} = window.fairEventsSignupBlock || {};

		const innerBlocksProps = useInnerBlocksProps(
			{ className: 'fair-events-event-signup-questions' },
			{
				allowedBlocks,
				renderAppender: InnerBlocks.ButtonBlockAppender,
			}
		);

		// The preview slot is injected into the SSR markup asynchronously
		// (after the REST fetch resolves, and again on every re-render that
		// changes an SSR attribute), so watch for it with a MutationObserver
		// rather than assuming it's there on mount.
		const previewRef = useRef( null );
		const [ slotNode, setSlotNode ] = useState( null );

		useEffect( () => {
			const container = previewRef.current;
			if ( ! container ) {
				return;
			}

			const findSlot = () => {
				setSlotNode(
					container.querySelector( QUESTIONS_SLOT_SELECTOR )
				);
			};

			findSlot();

			const observer = new MutationObserver( ( records ) => {
				// The portal's own content lands inside the slot node, which
				// is itself inside the observed subtree, so most mutations
				// here are just React writing the editable area into place.
				// Only re-resolve the slot when a mutation happened outside
				// it — that's an SSR refetch replacing the preview markup.
				const currentSlot = container.querySelector(
					QUESTIONS_SLOT_SELECTOR
				);
				const isPortalOnlyChange = records.every(
					( record ) =>
						currentSlot && currentSlot.contains( record.target )
				);
				if ( isPortalOnlyChange ) {
					return;
				}
				findSlot();
			} );
			observer.observe( container, { childList: true, subtree: true } );

			return () => observer.disconnect();
		}, [] );

		const formContent = (
			<>
				<div className="fair-events-event-signup-questions-label">
					{ __( 'Form content', 'fair-events' ) }
				</div>
				<div { ...innerBlocksProps } />
			</>
		);

		return (
			<>
				<InspectorControls>
					<PanelBody title={ __( 'Form Settings', 'fair-events' ) }>
						<TextControl
							label={ __( 'Submit Button Text', 'fair-events' ) }
							value={ attributes.submitButtonText }
							onChange={ ( value ) =>
								setAttributes( { submitButtonText: value } )
							}
						/>
						<ToggleControl
							label={ __( 'Show ticket price', 'fair-events' ) }
							checked={ attributes.showTicketPrice }
							onChange={ ( value ) =>
								setAttributes( { showTicketPrice: value } )
							}
						/>
						<ToggleControl
							label={ __( 'Show option prices', 'fair-events' ) }
							checked={ attributes.showOptionPrices }
							onChange={ ( value ) =>
								setAttributes( { showOptionPrices: value } )
							}
						/>
						<ToggleControl
							label={ __(
								'Show mailing signup checkbox',
								'fair-events'
							) }
							checked={ attributes.showKeepInformed }
							onChange={ ( value ) =>
								setAttributes( { showKeepInformed: value } )
							}
						/>
						{ ticketingEnabled &&
							canManageEvents &&
							( postEventDateId > 0 ? (
								<ExternalLink
									href={ `${ manageEventUrl }&event_date_id=${ postEventDateId }&tab=prices` }
								>
									{ __( 'Edit tickets', 'fair-events' ) }
								</ExternalLink>
							) : (
								<p>
									{ __(
										'Connect this block to an event date to edit its tickets.',
										'fair-events'
									) }
								</p>
							) ) }
					</PanelBody>
				</InspectorControls>

				<div { ...blockProps }>
					<div ref={ previewRef }>
						<ServerSideRender
							block={ UNIFIED_NAME }
							attributes={ {
								...attributes,
								isEditorPreview: true,
							} }
						/>
					</div>
					{ slotNode
						? createPortal( formContent, slotNode )
						: formContent }
				</div>
			</>
		);
	},
	save: () => {
		// Dynamic block (rendered via render.php), but the nested question
		// blocks must be serialized so render.php receives them as $content.
		return <InnerBlocks.Content />;
	},
	deprecated: [
		{
			// Previously a pure dynamic block with no saved markup. Existing
			// instances have no inner blocks, so migrating them to the
			// InnerBlocks.Content save is a no-op that avoids block recovery.
			save: () => null,
		},
	],
} );
