<?php
/**
 * REST API controller for the team member directory.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\TeamMemberRepository;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Administrator-only list, read, create, update and delete of sitewide team
 * member profiles (#2394).
 *
 * `/fair-events/v1/team-members` and `/fair-events/v1/team-members/{id}`.
 * Profiles carry personal contact details, so every route requires
 * `manage_options`. Registered only while the `team-members` bundle is on.
 *
 * Only the name is required. On update, omitted fields keep their value and
 * an empty string (or null for the gender) clears one. Every problem is
 * reported together, keyed by field, in the standard `rest_invalid_param`
 * shape, and a rejected submission changes nothing. A profile still linked
 * to events cannot be deleted (409 `rest_team_member_linked`, with the
 * events in `data.events`).
 */
class TeamMembersController extends WP_REST_Controller {

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
	protected $rest_base = 'team-members';

	/**
	 * Maximum stored length of each text field.
	 */
	private const MAX_LENGTHS = array(
		'name'         => 191,
		'surname'      => 191,
		'instagram'    => 191,
		'email'        => 254,
		'facebook_url' => 500,
		'phone'        => 64,
	);

	/**
	 * Storage.
	 *
	 * @var TeamMemberRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new TeamMemberRepository();
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
					'args'                => $this->get_profile_args(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				'args' => array(
					'id' => array(
						'description' => __( 'Unique identifier for the team member.', 'fair-events-experimental' ),
						'type'        => 'integer',
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
					'args'                => $this->get_profile_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Only administrators manage the directory: profiles hold personal data.
	 *
	 * @return string
	 */
	protected function manage_permission_message() {
		return __( 'You do not have permission to manage team members.', 'fair-events-experimental' );
	}

	/**
	 * List every profile, by name.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		return new WP_REST_Response( $this->repository->all(), 200 );
	}

	/**
	 * Read one profile with the events it is linked to.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$profile = $this->repository->find( (int) $request['id'] );
		if ( null === $profile ) {
			return $this->not_found();
		}

		$profile['events'] = $this->linked_events( $profile['id'] );

		return new WP_REST_Response( $profile, 200 );
	}

	/**
	 * Create a profile.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$data = $this->validate_submission( $request, true );
		if ( is_wp_error( $data ) ) {
			return $data;
		}

		$profile = $this->repository->create( $data );
		if ( null === $profile ) {
			return new WP_Error(
				'rest_team_member_not_saved',
				__( 'The team member could not be saved. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$profile['events'] = array();

		return new WP_REST_Response( $profile, 201 );
	}

	/**
	 * Update the given fields of a profile.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id = (int) $request['id'];
		if ( null === $this->repository->find( $id ) ) {
			return $this->not_found();
		}

		$data = $this->validate_submission( $request, false );
		if ( is_wp_error( $data ) ) {
			return $data;
		}

		$profile = $this->repository->update( $id, $data );
		if ( null === $profile ) {
			return new WP_Error(
				'rest_team_member_not_saved',
				__( 'The team member could not be saved. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$profile['events'] = $this->linked_events( $id );

		return new WP_REST_Response( $profile, 200 );
	}

	/**
	 * Delete a profile that no event links to.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id     = (int) $request['id'];
		$result = $this->repository->delete( $id );

		if ( true === $result ) {
			return new WP_REST_Response(
				array(
					'deleted' => true,
					'id'      => $id,
				),
				200
			);
		}

		if ( 'not_found' === $result ) {
			return $this->not_found();
		}

		if ( 'linked' === $result ) {
			$events = $this->linked_events( $id );
			return new WP_Error(
				'rest_team_member_linked',
				sprintf(
					/* translators: %d: number of events the team member is linked to */
					_n(
						'This team member is still linked to %d event. Remove them from it first.',
						'This team member is still linked to %d events. Remove them from those events first.',
						count( $events ),
						'fair-events-experimental'
					),
					count( $events )
				),
				array(
					'status' => 409,
					'events' => $events,
				)
			);
		}

		return new WP_Error(
			'rest_team_member_not_deleted',
			__( 'The team member could not be deleted. Try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * The events a profile is linked to, for administrators.
	 *
	 * @param int $member_id Profile ID.
	 * @return array[] `{ event_date_id, title, start_date, is_series }` per owning event.
	 */
	private function linked_events( $member_id ) {
		$owner_ids = $this->repository->owner_ids_for_member( $member_id );
		$dates     = EventDates::get_by_ids( $owner_ids );
		$events    = array();

		foreach ( $owner_ids as $owner_id ) {
			$date     = $dates[ $owner_id ] ?? null;
			$events[] = array(
				'event_date_id' => (int) $owner_id,
				'title'         => $date ? (string) $date->get_display_title() : '',
				'start_date'    => $date ? $date->start_date : null,
				'is_series'     => $date ? 'master' === $date->occurrence_type : false,
			);
		}

		return $events;
	}

	/**
	 * Validate a submission. On create, omitted fields are blank; on update,
	 * only the fields present are validated and changed.
	 *
	 * @param WP_REST_Request $request   Request object.
	 * @param bool            $is_create Whether a new profile is being created.
	 * @return array|WP_Error Fields to store, or the validation errors.
	 */
	private function validate_submission( $request, $is_create ) {
		$params = $request->get_params();
		$errors = array();
		$data   = array();

		foreach ( TeamMemberRepository::TEXT_FIELDS as $field ) {
			if ( ! $is_create && ! array_key_exists( $field, $params ) ) {
				continue;
			}
			$raw = $params[ $field ] ?? '';
			if ( null !== $raw && ! is_scalar( $raw ) ) {
				$errors[ $field ] = __( 'Enter text.', 'fair-events-experimental' );
				continue;
			}
			$value          = trim( sanitize_text_field( (string) $raw ) );
			$data[ $field ] = $value;

			if ( mb_strlen( $value ) > self::MAX_LENGTHS[ $field ] ) {
				$errors[ $field ] = sprintf(
					/* translators: %d: maximum number of characters */
					__( 'Use at most %d characters.', 'fair-events-experimental' ),
					self::MAX_LENGTHS[ $field ]
				);
			}
		}

		if ( array_key_exists( 'name', $data ) && '' === $data['name'] ) {
			$errors['name'] = __( 'Enter a name for the team member.', 'fair-events-experimental' );
		}

		if ( ! empty( $data['email'] ) && ! isset( $errors['email'] ) && ! is_email( $data['email'] ) ) {
			$errors['email'] = __( 'Enter a valid email address, e.g. ana@example.com, or leave it empty.', 'fair-events-experimental' );
		}

		if ( ! empty( $data['facebook_url'] ) && ! isset( $errors['facebook_url'] ) && ! self::is_facebook_url( $data['facebook_url'] ) ) {
			$errors['facebook_url'] = __( 'Enter the full address of a Facebook profile, e.g. https://www.facebook.com/name, or leave it empty.', 'fair-events-experimental' );
		}

		if ( $is_create || array_key_exists( 'gender', $params ) ) {
			$gender = $params['gender'] ?? null;
			if ( null === $gender || '' === $gender ) {
				$data['gender'] = null;
			} elseif ( is_string( $gender ) && in_array( $gender, TeamMemberRepository::GENDERS, true ) ) {
				$data['gender'] = $gender;
			} else {
				$errors['gender'] = __( 'Choose male, female or nonbinary, or leave the grammatical gender unset.', 'fair-events-experimental' );
			}
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
	 * Whether a value is an absolute http(s) URL on Facebook.
	 *
	 * @param string $value Candidate URL.
	 * @return bool
	 */
	private static function is_facebook_url( $value ) {
		if ( ! filter_var( $value, FILTER_VALIDATE_URL ) ) {
			return false;
		}

		$parts  = wp_parse_url( $value );
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
		$host   = strtolower( (string) ( $parts['host'] ?? '' ) );
		$path   = trim( (string) ( $parts['path'] ?? '' ), '/' );

		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
			return false;
		}

		$on_facebook = false;
		foreach ( array( 'facebook.com', 'fb.com' ) as $domain ) {
			if ( $host === $domain || str_ends_with( $host, '.' . $domain ) ) {
				$on_facebook = true;
			}
		}

		// A profile has a path or a profile.php?id= query.
		return $on_facebook && ( '' !== $path || ! empty( $parts['query'] ) );
	}

	/**
	 * Error for an unknown profile ID.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'rest_team_member_not_found',
			__( 'Team member not found.', 'fair-events-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Arguments accepted when creating or updating a profile. Core checks
	 * the types; {@see self::validate_submission()} checks the values.
	 *
	 * @return array
	 */
	private function get_profile_args() {
		$string = array( 'type' => 'string' );

		return array(
			'name'         => $string,
			'surname'      => $string,
			'instagram'    => $string,
			'email'        => $string,
			'facebook_url' => $string,
			'phone'        => $string,
			'gender'       => array(
				'type' => array( 'string', 'null' ),
			),
		);
	}
}
