<?php
/**
 * Block registration hooks for Fair Form
 *
 * @package FairForm
 */

namespace FairForm\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration for fair-form blocks.
 */
class BlockHooks {

	/**
	 * Constructor - registers WordPress hooks.
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register all fair-form block types.
	 *
	 * Block names (fair-audience/fair-form*) are kept unchanged — they are
	 * stored in post content and cannot change without a data migration.
	 * Script handles change from fair-audience-fair-form-* to
	 * fair-form-fair-form-* because the build now lives in fair-form.
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-short-text' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-long-text' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-phone' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-select-one' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-multiselect' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-radio' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-option' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-file-upload' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-conditional' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-mailing-signup' );

		$translations_path = \FairForm\Core\Features::script_translations_path();

		// block.json textdomain stays 'fair-audience' (block names are fair-audience/*).
		wp_set_script_translations( 'fair-form-fair-form-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-view-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-short-text-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-long-text-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-phone-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-select-one-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-multiselect-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-radio-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-option-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-file-upload-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-conditional-editor-script', 'fair-audience', $translations_path );
		wp_set_script_translations( 'fair-form-fair-form-mailing-signup-editor-script', 'fair-audience', $translations_path );
	}
}
