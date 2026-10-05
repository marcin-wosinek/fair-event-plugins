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
		$this->register_event_signup_alias();
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/signups-list' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/audience-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/event-interest' );
		// Set script translations for mailing-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-editor-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for mailing-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-view-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for signups-list blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-signups-list-editor-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for audience-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-audience-signup-editor-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for audience-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-audience-signup-view-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for event-interest blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-event-interest-editor-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);

		// Set script translations for event-interest blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-event-interest-view-script',
			'fair-audience',
			\FairAudience\Core\Features::script_translations_path()
		);
	}

	/**
	 * Register the render-only alias that keeps pages saved with the removed
	 * fair-audience/event-signup block showing a signup form. It has no
	 * editor or frontend assets of its own and goes away once stored content
	 * is migrated (#1495).
	 *
	 * @return void
	 */
	private function register_event_signup_alias() {
		register_block_type(
			'fair-audience/event-signup',
			array(
				'api_version'     => 3,
				'attributes'      => array(
					'signupButtonText' => array( 'type' => 'string' ),
				),
				'supports'        => array( 'inserter' => false ),
				'render_callback' => array( $this, 'render_event_signup_alias' ),
			)
		);
	}

	/**
	 * Render a saved fair-audience/event-signup block as the unified
	 * fair-events/event-signup block, keeping its button text and its nested
	 * questions in their saved order.
	 *
	 * @param array     $attributes Saved block attributes.
	 * @param string    $content    Rendered inner blocks (unused).
	 * @param \WP_Block $block      Block instance.
	 * @return string Rendered output; empty when fair-events is inactive.
	 */
	public function render_event_signup_alias( $attributes, $content, $block ) {
		if ( ! \WP_Block_Type_Registry::get_instance()->is_registered( 'fair-events/event-signup' ) ) {
			return '';
		}

		$parsed_block = $block->parsed_block;

		// The unified form has no vetted upload path for anonymous visitors,
		// so a form that asks for a file is neither shown without the
		// question nor allowed to accept uploads.
		if ( self::contains_block( $parsed_block['innerBlocks'] ?? array(), 'fair-audience/fair-form-file-upload' ) ) {
			return '<p class="fair-audience-event-signup-unavailable">'
				. esc_html__( 'This form is temporarily unavailable. Please contact the organizer.', 'fair-audience' )
				. '</p>';
		}

		$unified_attributes = array_diff_key( $parsed_block['attrs'] ?? array(), array( 'signupButtonText' => true ) );
		// The removed block labelled its button "Sign Up" unless told otherwise.
		$unified_attributes['submitButtonText'] = isset( $attributes['signupButtonText'] ) && '' !== $attributes['signupButtonText']
			? $attributes['signupButtonText']
			: __( 'Sign Up', 'fair-audience' );

		$parsed_block['blockName'] = 'fair-events/event-signup';
		$parsed_block['attrs']     = $unified_attributes;

		return render_block( $parsed_block );
	}

	/**
	 * Whether a parsed block tree contains a block of the given name, at any
	 * depth.
	 *
	 * @param array  $blocks     Parsed blocks.
	 * @param string $block_name Block name to look for.
	 * @return bool
	 */
	private static function contains_block( array $blocks, $block_name ) {
		foreach ( $blocks as $inner_block ) {
			if ( ( $inner_block['blockName'] ?? null ) === $block_name ) {
				return true;
			}
			if ( ! empty( $inner_block['innerBlocks'] ) && self::contains_block( $inner_block['innerBlocks'], $block_name ) ) {
				return true;
			}
		}

		return false;
	}
}
