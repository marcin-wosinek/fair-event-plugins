<?php
/**
 * Block registration hooks for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

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
	 * Register all block types
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( __DIR__ . '/../../build/blocks/events-list' );
		register_block_type( __DIR__ . '/../../build/blocks/event-dates' );
	}

	/**
	 * Set script translations for block editor scripts
	 *
	 * @return void
	 */
	public function set_script_translations() {
		// WordPress auto-generates script handles based on block name and file
		// Format: {namespace}-{block-name}-editor-script
		$plugin_dir = plugin_dir_path( __DIR__ . '/../../fair-events.php' );

		// Events list block editor script
		wp_set_script_translations(
			'fair-events-events-list-editor-script',
			'fair-events',
			$plugin_dir . 'build/languages'
		);

		// Event dates block editor script
		wp_set_script_translations(
			'fair-events-event-dates-editor-script',
			'fair-events',
			$plugin_dir . 'build/languages'
		);
	}
}
