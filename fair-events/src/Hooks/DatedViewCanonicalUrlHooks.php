<?php
/**
 * Canonical URL for dated calendar/week views
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Helpers\DatedViewCanonicalUrl;

defined( 'WPINC' ) || die;

/**
 * Filters WordPress' `get_canonical_url` so a page carrying an
 * events-calendar or events-week block, requested with an in-window
 * `calendar_month`/`calendar_year` or `week_view` param, declares that dated
 * view's own canonical URL instead of collapsing onto the page's default
 * (undated) view.
 *
 * Kept separate from CanonicalUrlHooks (per-occurrence event pages): that
 * hook is scoped to Settings::get_enabled_post_types(), while these blocks
 * can be placed on any singular post/page.
 */
class DatedViewCanonicalUrlHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_filter( 'get_canonical_url', array( $this, 'filter_canonical_url' ), 10, 2 );
	}

	/**
	 * Adjust the canonical URL for a singular page/post.
	 *
	 * @param string   $canonical_url WordPress' computed canonical URL.
	 * @param \WP_Post $post          The queried post.
	 * @return string Canonical URL.
	 */
	public function filter_canonical_url( $canonical_url, $post ) {
		if ( ! is_singular() ) {
			return $canonical_url;
		}

		return DatedViewCanonicalUrl::for_post( $post, $canonical_url );
	}
}
