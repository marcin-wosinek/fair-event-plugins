<?php
/**
 * Block Hooks
 *
 * @package FairTeam
 */

namespace FairTeam\Hooks;

defined( 'WPINC' ) || die;

/**
 * Class for registering blocks.
 */
class BlockHooks {

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register blocks.
	 */
	public function register_blocks() {
		// Register blocks from build directory
		register_block_type( FAIR_TEAM_PLUGIN_DIR . 'build/blocks/team-members-list' );

		// Set script translations
		wp_set_script_translations(
			'fair-team-team-members-list-editor-script',
			'fair-team',
			FAIR_TEAM_PLUGIN_DIR . 'build/languages'
		);
	}
}
