<?php
/**
 * Sitewide Organization JSON-LD structured data for Fair Events
 *
 * Outputs a sitewide Schema.org Organization/SportsClub JSON-LD block on
 * wp_head, built from the `fair_events_organizer` setting, so search engines
 * and AI systems can confirm who the organizer is and connect them to their
 * known social profiles.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Helpers\OrganizationSchema;

defined( 'WPINC' ) || die;

/**
 * Handles the sitewide Organization JSON-LD block.
 */
class OrganizationHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		// Priority 2, deliberately after OpenGraphHooks' priority-1 event
		// JSON-LD, so the single-event Event block stays first in the head.
		add_action( 'wp_head', array( $this, 'output_organization_jsonld' ), 2 );
	}

	/**
	 * Output the sitewide Organization/SportsClub JSON-LD block.
	 *
	 * @return void
	 */
	public function output_organization_jsonld() {
		if ( ! apply_filters( 'fair_events_output_organization_jsonld', true ) ) {
			return;
		}

		$org = OrganizationSchema::organization_to_jsonld();
		if ( null === $org ) {
			return;
		}

		$data = apply_filters(
			'fair_events_organization_jsonld',
			array_merge( array( '@context' => 'https://schema.org' ), $org )
		);

		echo '<script type="application/ld+json">' . "\n";
		echo wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT );
		echo "\n" . '</script>' . "\n";
	}
}
