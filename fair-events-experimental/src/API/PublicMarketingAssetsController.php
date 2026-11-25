<?php
/**
 * Public REST API controller for occurrence marketing assets.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Services\PublicMarketingAssets;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Anonymous, read-only access to marketing assets (#2430).
 *
 * - `GET /fair-events/v1/marketing-assets` — the occurrences that have an
 *   asset page, newest first.
 * - `GET /fair-events/v1/marketing-assets/{event_date_id}` — one
 *   occurrence's assets, filterable by `label` and `member`, with the
 *   filters it offers.
 *
 * Registered only while the `marketing-assets` bundle is on; every
 * occurrence is answered whatever its publication status. Responses carry
 * only the fields {@see PublicMarketingAssets} projects and are never
 * cached, so a removal or turning the bundle off applies on the next
 * request. See docs/marketing-assets.md.
 */
class PublicMarketingAssetsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Resource name.
	 *
	 * @var string
	 */
	protected $rest_base = 'marketing-assets';

	/**
	 * Service.
	 *
	 * @var PublicMarketingAssets
	 */
	private $service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->service = new PublicMarketingAssets();
	}

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					// Public on purpose: marketing assets are shared with
					// collaborators who have no account (#2430).
					'permission_callback' => '__return_true',
					'args'                => $this->get_collection_params(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<event_date_id>\d+)',
			array(
				'args' => array(
					'event_date_id' => array(
						'description' => __( 'Event date (occurrence) whose assets to list.', 'fair-events-experimental' ),
						'type'        => 'integer',
					),
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					// Public on purpose: see the collection route.
					'permission_callback' => '__return_true',
					'args'                => array_merge(
						$this->get_collection_params(),
						array(
							'label'  => array(
								'description' => __( 'Only assets with exactly this use case.', 'fair-events-experimental' ),
								'type'        => 'string',
							),
							'member' => array(
								'description' => __( 'Only assets showing this team member: a key from filters.members.', 'fair-events-experimental' ),
								'type'        => 'string',
								'pattern'     => '^[0-9a-f]{16}$',
							),
						)
					),
				),
			)
		);
	}

	/**
	 * Pagination arguments.
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'     => array(
				'description' => __( 'Page of the list, from 1.', 'fair-events-experimental' ),
				'type'        => 'integer',
				'default'     => 1,
				'minimum'     => 1,
			),
			'per_page' => array(
				'description' => __( 'Entries per page.', 'fair-events-experimental' ),
				'type'        => 'integer',
				'default'     => 50,
				'minimum'     => 1,
				'maximum'     => 100,
			),
		);
	}

	/**
	 * List the occurrences with an asset page.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$list = $this->service->discover( (int) $request['page'], (int) $request['per_page'] );
		return self::uncached( $list );
	}

	/**
	 * List one occurrence's assets.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['event_date_id'] );
		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'This event has no marketing assets page. Check the link, or open the list of all events.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}

		$label  = $request->has_param( 'label' ) && '' !== (string) $request['label'] ? (string) $request['label'] : null;
		$member = $request->has_param( 'member' ) && '' !== (string) $request['member'] ? (string) $request['member'] : null;
		$list   = $this->service->list_assets( $event_date, (int) $request['page'], (int) $request['per_page'], $label, $member );

		return self::uncached( $list );
	}

	/**
	 * A response that page and CDN caches must not keep, with the list's
	 * totals in headers.
	 *
	 * @param array $body List.
	 * @return WP_REST_Response
	 */
	private static function uncached( array $body ) {
		$response = new WP_REST_Response( $body, 200 );
		foreach ( wp_get_nocache_headers() as $name => $value ) {
			if ( $value ) {
				$response->header( $name, $value );
			}
		}
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'X-Robots-Tag', 'noindex' );
		$response->header( 'X-WP-Total', (string) $body['total'] );
		$response->header( 'X-WP-TotalPages', (string) $body['total_pages'] );
		return $response;
	}
}
