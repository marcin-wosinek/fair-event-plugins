/**
 * Event Signup Block - Editor Component
 *
 * Canonical fair-events signup block. Base behaviour is the anonymous
 * get-tickets form; when fair-audience is active the render delegates to its
 * participant-aware flow.
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
import { ExternalLink, PanelBody, TextControl } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { createPortal, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';
import './editor.css';

const UNIFIED_NAME = 'fair-events/event-signup';

// Where render.php puts an empty slot (instead of the real nested content)
// when isEditorPreview is set, so the editor can portal the editable "Form
// content" area into the same on-screen position as the frontend.
const QUESTIONS_SLOT_SELECTOR = '.fair-events-event-signup-questions-slot';

// Blocks always allowed in the form content area, regardless of fair-form.
const BASE_ALLOWED_BLOCKS = ['core/heading', 'core/paragraph', 'core/list'];

// Custom question blocks that can additionally be nested once fair-form is
// active. Mirrors the legacy fair-audience/event-signup block's set, minus
// the file-upload question: the unified form is submittable by anonymous
// visitors and uploads stay out until there is a vetted path.
const FAIR_FORM_ALLOWED_BLOCKS = [
	'fair-audience/fair-form-short-text',
	'fair-audience/fair-form-long-text',
	'fair-audience/fair-form-phone',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-radio',
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-consent',
	'fair-audience/fair-form-conditional',
];

registerBlockType(metadata.name, {
	...metadata,
	edit: function Edit({ attributes, setAttributes }) {
		const blockProps = useBlockProps();

		// The fair-form question set is only registered when fair-form is
		// active. Without it, offer no question blocks — there is no
		// fair-events-owned default question set.
		const isFairFormActive = useSelect(
			(select) =>
				!!select('core/blocks').getBlockType(
					'fair-audience/fair-form-short-text'
				),
			[]
		);

		const allowedBlocks = isFairFormActive
			? [...BASE_ALLOWED_BLOCKS, ...FAIR_FORM_ALLOWED_BLOCKS]
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
		const previewRef = useRef(null);
		const [slotNode, setSlotNode] = useState(null);

		useEffect(() => {
			const container = previewRef.current;
			if (!container) {
				return;
			}

			const findSlot = () => {
				setSlotNode(container.querySelector(QUESTIONS_SLOT_SELECTOR));
			};

			findSlot();

			const observer = new MutationObserver((records) => {
				// The portal's own content lands inside the slot node, which
				// is itself inside the observed subtree, so most mutations
				// here are just React writing the editable area into place.
				// Only re-resolve the slot when a mutation happened outside
				// it — that's an SSR refetch replacing the preview markup.
				const currentSlot = container.querySelector(
					QUESTIONS_SLOT_SELECTOR
				);
				const isPortalOnlyChange = records.every(
					(record) =>
						currentSlot && currentSlot.contains(record.target)
				);
				if (isPortalOnlyChange) {
					return;
				}
				findSlot();
			});
			observer.observe(container, { childList: true, subtree: true });

			return () => observer.disconnect();
		}, []);

		const formContent = (
			<>
				<div className="fair-events-event-signup-questions-label">
					{__('Form content', 'fair-events')}
				</div>
				<div {...innerBlocksProps} />
			</>
		);

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-events')}>
						<TextControl
							label={__('Submit Button Text', 'fair-events')}
							value={attributes.submitButtonText}
							onChange={(value) =>
								setAttributes({ submitButtonText: value })
							}
						/>
						{ticketingEnabled &&
							canManageEvents &&
							(postEventDateId > 0 ? (
								<ExternalLink
									href={`${manageEventUrl}&event_date_id=${postEventDateId}&tab=tickets`}
								>
									{__('Edit tickets', 'fair-events')}
								</ExternalLink>
							) : (
								<p>
									{__(
										'Connect this block to an event date to edit its tickets.',
										'fair-events'
									)}
								</p>
							))}
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<div ref={previewRef}>
						<ServerSideRender
							block={UNIFIED_NAME}
							attributes={{
								...attributes,
								isEditorPreview: true,
							}}
						/>
					</div>
					{slotNode
						? createPortal(formContent, slotNode)
						: formContent}
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
});
