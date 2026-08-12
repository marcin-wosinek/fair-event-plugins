<?php
/**
 * Block registration hooks for Fair Calendar Button
 *
 * @package FairCalendarButton
 */

namespace FairCalendarButton\Hooks;

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
		add_action( 'init', array( $this, 'set_script_translations' ) );
	}

	/**
	 * Register calendar button block type
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( __DIR__ . '/../../build/blocks/calendar-button' );
	}

	/**
	 * Set script translations for frontend JavaScript
	 *
	 * Relies on the WordPress.org language pack (no bundled-translations
	 * flag in this plugin), so no path argument is passed — core resolves
	 * the JSON from wp-content/languages/plugins/.
	 *
	 * @return void
	 */
	public function set_script_translations() {
		// WordPress auto-generates script handles based on block name and file.
		// Editor script handle: fair-calendar-button-calendar-button-editor-script
		// Frontend script handle: fair-calendar-button-calendar-button-view-script.
		wp_set_script_translations(
			'fair-calendar-button-calendar-button-editor-script',
			'fair-calendar-button'
		);

		wp_set_script_translations(
			'fair-calendar-button-calendar-button-view-script',
			'fair-calendar-button'
		);
	}
}
