<?php
/**
 * Block Renderer - renders any registered block in a given post/user context.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared;

/**
 * Renders a registered WordPress block with the specified context.
 */
class BlockRenderer {

	/**
	 * Render a block by name with given attributes and context.
	 *
	 * @param string   $block_name Block name (e.g. "fair-events/events-list").
	 * @param array    $attributes Block attributes.
	 * @param int|null $post_id    Optional post ID for post context.
	 * @return string Rendered HTML.
	 */
	public function render( string $block_name, array $attributes = array(), ?int $post_id = null ): string {
		if ( $post_id ) {
			$this->setup_post_context( $post_id );
		}

		$html = render_block(
			array(
				'blockName' => $block_name,
				'attrs'     => $attributes,
			)
		);

		if ( $post_id ) {
			wp_reset_postdata();
		}

		return $html;
	}

	/**
	 * Set up the global post context.
	 *
	 * @param int $post_id Post ID.
	 */
	private function setup_post_context( int $post_id ): void {
		global $post;
		$post = get_post( $post_id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		setup_postdata( $post );
	}
}
