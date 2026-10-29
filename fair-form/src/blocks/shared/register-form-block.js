/**
 * Registration for Fair Form blocks under both namespaces (#1161).
 *
 * The blocks are registered as `fair-form/<slug>`. Content saved before the
 * rename uses `fair-audience/<slug>`; Fair Form keeps those names registered
 * as hidden aliases (see FairForm\Hooks\BlockHooks) so the content still
 * renders and opens in the editor. In the editor, a legacy block replaces
 * itself, with everything nested in it, by the canonical blocks, so the next
 * save stores only canonical names.
 */
import { registerBlockType, createBlock } from '@wordpress/blocks';
import { useEffect } from '@wordpress/element';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as blockEditorStore } from '@wordpress/block-editor';
import {
	FAIR_FORM_BLOCK_NAMESPACE,
	LEGACY_FAIR_FORM_BLOCK_NAMESPACE,
	LEGACY_FAIR_FORM_BLOCK_SLUGS,
	canonicalFairFormBlockName,
} from 'fair-events-shared/src/question-utils.js';

/**
 * Whether a block name is a legacy Fair Form block name.
 *
 * @param {string} name Block name.
 * @return {boolean} True for `fair-audience/fair-form*` Fair Form blocks.
 */
export function isLegacyFormBlockName( name ) {
	return canonicalFairFormBlockName( name ) !== name;
}

/**
 * Rebuild a block tree with every legacy Fair Form block renamed to its
 * canonical name. Attributes and nesting are kept; other blocks are copied.
 *
 * @param {Object} block Block from the block editor store.
 * @return {Object} New block with canonical names.
 */
export function toCanonicalFormBlock( block ) {
	return createBlock(
		canonicalFairFormBlockName( block.name ),
		block.attributes,
		( block.innerBlocks || [] ).map( toCanonicalFormBlock )
	);
}

/**
 * Wrap a canonical block's edit component for its legacy alias.
 *
 * The outermost legacy block converts the whole subtree as soon as the
 * canonical block is allowed where it sits; nested legacy blocks leave it to
 * their legacy parent. A parent's allow-list can be registered after its
 * children mount, so this follows the editor state rather than checking
 * once. While the canonical block is not allowed (e.g. an older Fair Events
 * whose Event Signup allow-list only knows the legacy names), the block
 * stays editable under its legacy name.
 *
 * @param {Function} Edit Canonical edit component.
 * @return {Function} Edit component for the legacy alias.
 */
function withLegacyConversion( Edit ) {
	return function LegacyFormBlockEdit( props ) {
		const { clientId } = props;
		const canConvert = useSelect(
			( select ) => {
				const {
					getBlockName,
					getBlockRootClientId,
					canInsertBlockType,
				} = select( blockEditorStore );
				const rootClientId = getBlockRootClientId( clientId );
				if (
					rootClientId &&
					isLegacyFormBlockName( getBlockName( rootClientId ) )
				) {
					return false;
				}
				return canInsertBlockType(
					canonicalFairFormBlockName( getBlockName( clientId ) ),
					rootClientId
				);
			},
			[ clientId ]
		);
		const { getBlock } = useSelect( blockEditorStore );
		const { replaceBlocks, __unstableMarkNextChangeAsNotPersistent } =
			useDispatch( blockEditorStore );

		useEffect( () => {
			const block = canConvert && getBlock( clientId );
			if ( ! block ) {
				return;
			}

			// The rename is not an edit the user made, so it gets no undo step.
			__unstableMarkNextChangeAsNotPersistent?.();
			replaceBlocks( clientId, toCanonicalFormBlock( block ) );
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [ canConvert ] );

		return <Edit { ...props } />;
	};
}

/**
 * Register a Fair Form block and, for a block from before #1161, its hidden
 * legacy alias.
 *
 * The alias's metadata (title, attributes, hidden from the inserter) comes
 * from its PHP registration; only the editor behaviour is set here.
 *
 * @param {string} slug     Block slug, e.g. `fair-form-email`.
 * @param {Object} settings Client-side settings of the canonical block.
 * @return {Object|undefined} The registered canonical block type.
 */
export function registerFormBlockType( slug, settings ) {
	const blockType = registerBlockType(
		`${ FAIR_FORM_BLOCK_NAMESPACE }/${ slug }`,
		settings
	);

	if ( LEGACY_FAIR_FORM_BLOCK_SLUGS.includes( slug ) ) {
		registerBlockType( `${ LEGACY_FAIR_FORM_BLOCK_NAMESPACE }/${ slug }`, {
			edit: withLegacyConversion( settings.edit ),
			save: settings.save,
		} );
	}

	return blockType;
}
