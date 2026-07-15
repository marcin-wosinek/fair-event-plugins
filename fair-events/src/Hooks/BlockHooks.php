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
		// Core blocks — always available in the inserter.
		register_block_type( __DIR__ . '/../../build/blocks/events-list' );
		register_block_type( __DIR__ . '/../../build/blocks/event-dates' );
		register_block_type( __DIR__ . '/../../build/blocks/events-calendar' );
		register_block_type( __DIR__ . '/../../build/blocks/events-week' );
		register_block_type( __DIR__ . '/../../build/blocks/event-info' );

		// `sources` bundle — event-proposal block writes to EventProposalController.
		if ( \FairEvents\Core\Features::is_enabled( 'sources' ) ) {
			register_block_type( __DIR__ . '/../../build/blocks/event-proposal' );
		}

		// Unified signup block (fair-events owned). Base behaviour is the
		// anonymous get-tickets form; when fair-audience is active the render
		// delegates to its participant-aware Event Signup flow.
		register_block_type( __DIR__ . '/../../build/blocks/event-signup' );

		// Legacy get-tickets block — kept registered (hidden from the inserter)
		// so existing posts keep working; its render delegates to the unified
		// block above.
		register_block_type( __DIR__ . '/../../build/blocks/get-tickets' );
	}

	/**
	 * Set script translations for block editor scripts
	 *
	 * @return void
	 */
	public function set_script_translations() {
		// WordPress auto-generates script handles based on block name and file.
		// Format: {namespace}-{block-name}-editor-script.
		$plugin_dir = plugin_dir_path( __DIR__ . '/../../fair-events.php' );

		// Events list block editor script.
		wp_set_script_translations(
			'fair-events-events-list-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event dates block editor script.
		wp_set_script_translations(
			'fair-events-event-dates-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Events calendar block editor script.
		wp_set_script_translations(
			'fair-events-events-calendar-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Events week view block editor script.
		wp_set_script_translations(
			'fair-events-events-week-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event proposal block editor script.
		wp_set_script_translations(
			'fair-events-event-proposal-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event proposal block view script (frontend).
		wp_set_script_translations(
			'fair-events-event-proposal-view-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event info block editor script.
		wp_set_script_translations(
			'fair-events-event-info-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event signup block editor script (unified block).
		wp_set_script_translations(
			'fair-events-event-signup-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Event signup block view script (frontend).
		wp_set_script_translations(
			'fair-events-event-signup-view-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);

		// Get tickets block editor script (legacy alias).
		wp_set_script_translations(
			'fair-events-get-tickets-editor-script',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);
	}
}
