<?php
/**
 * REST API controller for managing organizers.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Settings\Organizer;
use FairEventsExperimental\Models\OrganizerRepository;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Administrator-only list, read, create and update of organizers.
 *
 * The sitewide default is addressed as `default` and kept in Fair Events'
 * own option; additional organizers have UUIDs. Every write submits the
 * complete record and is validated as a whole before anything is stored, so
 * a rejected submission leaves the saved organizer unchanged. Responses
 * include the private notification recipients, which is why every route
 * requires `manage_options`.
 */
class OrganizersController extends WP_REST_Controller {

	use ManageOptionsPermissions;

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
	protected $rest_base = 'organizers';

	/**
	 * Organizer storage.
	 *
	 * @var OrganizerRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new OrganizerRepository();
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
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_organizer_args(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[A-Za-z0-9-]+)',
			array(
				'args' => array(
					'id' => array(
						'description' => __( 'Organizer ID: "default" for the sitewide organizer, or a UUID.', 'fair-events-experimental' ),
						'type'        => 'string',
					),
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_organizer_args(),
				),
			)
		);
	}

	/**
	 * Only administrators manage organizers: responses carry private addresses.
	 *
	 * @return string
	 */
	protected function manage_permission_message() {
		return __( 'You do not have permission to manage organizers.', 'fair-events-experimental' );
	}

	/**
	 * List all organizers, the default first.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		return new WP_REST_Response( $this->repository->all(), 200 );
	}

	/**
	 * Read one organizer.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$organizer = $this->repository->find( $request['id'] );
		if ( null === $organizer ) {
			return $this->not_found();
		}

		return new WP_REST_Response( $organizer, 200 );
	}

	/**
	 * Create an additional organizer.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$data = $this->validate_submission( $request, false );
		if ( is_wp_error( $data ) ) {
			return $data;
		}

		$organizer = $this->repository->create( $data );
		if ( null === $organizer ) {
			return new WP_Error(
				'fair_events_organizer_not_saved',
				__( 'The organizer could not be saved. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $organizer, 201 );
	}

	/**
	 * Replace an organizer's fields with a complete, validated submission.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id = (string) $request['id'];
		if ( null === $this->repository->find( $id ) ) {
			return $this->not_found();
		}

		$data = $this->validate_submission( $request, OrganizerRepository::DEFAULT_ID === $id );
		if ( is_wp_error( $data ) ) {
			return $data;
		}

		$organizer = $this->repository->update( $id, $data );
		if ( null === $organizer ) {
			return $this->not_found();
		}

		return new WP_REST_Response( $organizer, 200 );
	}

	/**
	 * Validate a complete submission. Omitted fields count as blank.
	 *
	 * Fair Events' sanitizer silently drops invalid entries, so every field is
	 * checked here first and all problems are reported together, keyed by
	 * field, in the standard `rest_invalid_param` shape.
	 *
	 * @param WP_REST_Request $request    Request object.
	 * @param bool            $is_default Whether the sitewide default is being saved (its name may stay blank).
	 * @return array|WP_Error Trimmed organizer fields, or the validation errors.
	 */
	private function validate_submission( $request, $is_default ) {
		$errors = array();
		$data   = array();

		foreach ( array( 'name', 'street_address', 'address_locality', 'address_region', 'postal_code', 'address_country', 'contact_phone' ) as $field ) {
			$data[ $field ] = trim( sanitize_text_field( (string) $request->get_param( $field ) ) );
		}

		if ( ! $is_default && '' === $data['name'] ) {
			$errors['name'] = __( 'Enter a name for the organizer.', 'fair-events-experimental' );
		}

		$type = $request->get_param( 'type' );
		if ( null === $type || '' === $type ) {
			$data['type'] = 'Organization';
		} elseif ( in_array( $type, Organizer::TYPES, true ) ) {
			$data['type'] = $type;
		} else {
			$errors['type'] = sprintf(
				/* translators: %s: comma-separated list of allowed organizer types */
				__( 'Choose an organizer type: %s.', 'fair-events-experimental' ),
				implode( ', ', Organizer::TYPES )
			);
		}

		$website         = trim( (string) $request->get_param( 'website' ) );
		$data['website'] = $website;
		if ( '' !== $website && ! self::is_http_url( $website ) ) {
			$errors['website'] = __( 'Enter the website as a full URL, e.g. https://example.com.', 'fair-events-experimental' );
		}

		$data['same_as'] = array();
		foreach ( (array) $request->get_param( 'same_as' ) as $link ) {
			$link = trim( (string) $link );
			if ( '' === $link ) {
				continue;
			}
			if ( ! self::is_http_url( $link ) ) {
				$errors['same_as'] = sprintf(
					/* translators: %s: the rejected link as entered */
					__( '"%s" is not a valid link. Enter full URLs, e.g. https://example.com/profile.', 'fair-events-experimental' ),
					$link
				);
				break;
			}
			$data['same_as'][] = $link;
		}

		$contact_email         = trim( (string) $request->get_param( 'contact_email' ) );
		$data['contact_email'] = $contact_email;
		if ( '' !== $contact_email && ! is_email( $contact_email ) ) {
			$errors['contact_email'] = __( 'Enter a valid contact email address, e.g. info@example.com.', 'fair-events-experimental' );
		}

		$data['notification_emails'] = array();
		foreach ( (array) $request->get_param( 'notification_emails' ) as $email ) {
			$email = trim( (string) $email );
			if ( '' === $email ) {
				continue;
			}
			if ( ! is_email( $email ) ) {
				$errors['notification_emails'] = sprintf(
					/* translators: %s: the rejected email address as entered */
					__( '"%s" is not a valid notification email address.', 'fair-events-experimental' ),
					$email
				);
				break;
			}
			$data['notification_emails'][] = $email;
		}

		$logo_id         = absint( $request->get_param( 'logo_id' ) );
		$data['logo_id'] = $logo_id;
		if ( $logo_id && ! wp_attachment_is_image( $logo_id ) ) {
			$errors['logo_id'] = __( 'The selected logo is not an image in the Media Library. Choose another image.', 'fair-events-experimental' );
		}

		if ( $errors ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %s: comma-separated list of invalid field names */
					__( 'Invalid parameter(s): %s', 'fair-events-experimental' ),
					implode( ', ', array_keys( $errors ) )
				),
				array(
					'status' => 400,
					'params' => $errors,
				)
			);
		}

		return $data;
	}

	/**
	 * Whether a value is an absolute http(s) URL.
	 *
	 * @param string $value Candidate URL.
	 * @return bool
	 */
	private static function is_http_url( $value ) {
		if ( ! filter_var( $value, FILTER_VALIDATE_URL ) ) {
			return false;
		}

		$scheme = wp_parse_url( $value, PHP_URL_SCHEME );

		return in_array( strtolower( (string) $scheme ), array( 'http', 'https' ), true );
	}

	/**
	 * Error for an unknown organizer ID.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'fair_events_organizer_not_found',
			__( 'Organizer not found.', 'fair-events-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Arguments accepted when creating or updating an organizer. Core checks
	 * the types; {@see self::validate_submission()} checks the values.
	 *
	 * @return array
	 */
	private function get_organizer_args() {
		$string = array( 'type' => 'string' );

		return array(
			'name'                => $string,
			'type'                => $string,
			'street_address'      => $string,
			'address_locality'    => $string,
			'address_region'      => $string,
			'postal_code'         => $string,
			'address_country'     => $string,
			'website'             => $string,
			'contact_email'       => $string,
			'contact_phone'       => $string,
			'same_as'             => array(
				'type'  => 'array',
				'items' => $string,
			),
			'notification_emails' => array(
				'type'  => 'array',
				'items' => $string,
			),
			'logo_id'             => array(
				'type'    => 'integer',
				'minimum' => 0,
			),
		);
	}
}
