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
	 * WordPress derives the script handles from them
	 * (fair-audience-fair-form-*), while the text domain is Fair Form's own.
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-short-text' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-long-text' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-email' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-phone' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-url' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-date' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-datetime' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-select-one' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-multiselect' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-radio' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-option' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-file-upload' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-consent' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-conditional' );
		register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-mailing-signup' );

		$translations_path = \FairForm\Core\Features::script_translations_path();

		wp_set_script_translations( 'fair-audience-fair-form-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-view-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-short-text-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-long-text-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-email-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-phone-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-url-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-date-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-datetime-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-select-one-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-multiselect-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-radio-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-option-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-file-upload-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-consent-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-conditional-editor-script', 'fair-form', $translations_path );
		wp_set_script_translations( 'fair-audience-fair-form-mailing-signup-editor-script', 'fair-form', $translations_path );
	}
}
