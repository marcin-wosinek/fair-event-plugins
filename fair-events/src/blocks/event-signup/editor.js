/**
 * Event Signup Block - Editor Component
 *
 * Canonical fair-events signup block. Base behaviour is the anonymous
 * get-tickets form; when fair-audience is active the render delegates to its
 * participant-aware flow.
 *
 * This bundle also re-registers the legacy fair-audience/event-signup block to
 * hide it from the inserter and add a transform to this block (the sibling
 * legacy fair-events/get-tickets block handles its own transform).
 *
 * @package FairEvents
 */

import {
	registerBlockType,
	unregisterBlockType,
	getBlockType,
	createBlock,
} from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import domReady from '@wordpress/dom-ready';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';
import './editor.css';

const UNIFIED_NAME = 'fair-events/event-signup';

registerBlockType(metadata.name, {
	...metadata,
	edit: function Edit({ attributes, setAttributes }) {
		const blockProps = useBlockProps();

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
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block={UNIFIED_NAME}
						attributes={attributes}
					/>
				</div>
			</>
		);
	},
});

/**
 * Re-register the legacy fair-audience/event-signup block (owned by another
 * plugin) to hide it from the inserter and add a transform to the unified
 * block, mirroring the calendar-button precedent. Only runs when fair-audience
 * is active (otherwise the block isn't registered and this no-ops).
 *
 * @return {boolean} True once handled (or block absent for good).
 */
function migrateLegacyEventSignup() {
	const legacyName = 'fair-audience/event-signup';
	const blockType = getBlockType(legacyName);

	if (!blockType) {
		// Not registered yet (or fair-audience inactive) — retry a few times.
		return false;
	}

	const { name, ...settings } = blockType;

	const existingTo = settings.transforms?.to || [];
	const alreadyMigrated = existingTo.some(
		(t) => t.__fairEventsUnifiedTransform === true
	);
	if (alreadyMigrated) {
		return true;
	}

	const toUnified = {
		type: 'block',
		blocks: [UNIFIED_NAME],
		__fairEventsUnifiedTransform: true,
		transform: (attrs) =>
			createBlock(UNIFIED_NAME, {
				submitButtonText: attrs.signupButtonText,
			}),
	};

	unregisterBlockType(legacyName);
	registerBlockType(legacyName, {
		...settings,
		supports: {
			...settings.supports,
			inserter: false,
		},
		transforms: {
			...settings.transforms,
			to: [...existingTo, toUnified],
		},
	});

	return true;
}

domReady(() => {
	if (!migrateLegacyEventSignup()) {
		setTimeout(() => {
			if (!migrateLegacyEventSignup()) {
				setTimeout(migrateLegacyEventSignup, 500);
			}
		}, 100);
	}
});
