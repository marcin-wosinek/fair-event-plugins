<?php
/**
 * Block registration hooks for Fair Timetable
 *
 * @package FairTimetable
 */

namespace FairTimetable\Hooks;

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
		register_block_type( __DIR__ . '/../../build/blocks/timetable' );
		register_block_type( __DIR__ . '/../../build/blocks/time-slot' );
		register_block_type( __DIR__ . '/../../build/blocks/time-column-body' );
		register_block_type( __DIR__ . '/../../build/blocks/time-column' );
	}

	/**
	 * Set script translations for block editor and view scripts
	 *
	 * @return void
	 */
	public function set_script_translations() {
		// WordPress auto-generates script handles based on block name and file.
		// Format: {namespace}-{block-name}-{editor|view}-script.
		$plugin_dir = plugin_dir_path( __DIR__ . '/../../fair-timetable.php' );
		$languages  = $plugin_dir . 'build/languages';

		$blocks = array( 'timetable', 'time-slot', 'time-column-body', 'time-column' );

		foreach ( $blocks as $block ) {
			wp_set_script_translations(
				"fair-timetable-{$block}-editor-script",
				'fair-timetable',
				$languages
			);
			wp_set_script_translations(
				"fair-timetable-{$block}-view-script",
				'fair-timetable',
				$languages
			);
		}
	}
}
