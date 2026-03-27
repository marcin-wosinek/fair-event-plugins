<?php
/**
 * Block registration hooks for Fair Audience
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration and hooks
 */
class BlockHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register all block types
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/mailing-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/event-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/signups-list' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/audience-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-short-text' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-long-text' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-select-one' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-multiselect' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-radio' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-option' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/fair-form-file-upload' );

		// Set script translations for mailing-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for mailing-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for event-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-event-signup-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for event-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-event-signup-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for signups-list blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-signups-list-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for audience-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-audience-signup-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for audience-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-audience-signup-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-short-text blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-short-text-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-long-text blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-long-text-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-select-one blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-select-one-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-multiselect blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-multiselect-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-radio blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-radio-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-option blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-option-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for fair-form-file-upload blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-fair-form-file-upload-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);
	}
}
