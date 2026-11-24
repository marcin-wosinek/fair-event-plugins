<?php
/**
 * Promotional team member profiles for campaign facts.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEventsExperimental\Core\Plugin;
use FairEventsExperimental\EventImages\Source;
use FairEventsExperimental\Models\TeamMemberRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Reads the public promotional part of team member profiles in the
 * Event Content Studio campaign-facts v1 `team.members[]` shape (#2421).
 *
 * The caller resolves which contributors an event has and authorizes the
 * request for that event (#2424); this reader only turns those profile IDs
 * into the promotional allowlist. Contact details, grammatical gender and
 * event counts are never read or returned.
 *
 * Every outcome other than a complete read is a `WP_Error`, so a disabled
 * directory, a denied caller, a missing profile or a failed query never
 * looks like a team with no contributors:
 *
 * - `rest_forbidden` (401 anonymous, 403 otherwise): the current user
 *   cannot `edit_posts`, the capability campaign facts require. Checked
 *   first, so a denied caller learns nothing about the directory.
 * - `fair_events_team_directory_disabled` (409): the `team-members` bundle
 *   is off or was never installed. Campaign facts map this to
 *   `team.members: null`.
 * - `fair_events_team_member_missing` (500): a requested ID has no
 *   profile; the IDs are in `data.member_ids`.
 * - `fair_events_source_unavailable` (500): the query failed.
 * - `fair_events_campaign_facts_member_name_missing` (422): a profile has
 *   no usable name.
 *
 * An authorized read of no IDs returns no members.
 */
class PromotionalTeamProfiles {

	/**
	 * Campaign facts v1 Instagram handle pattern, without the `@`.
	 */
	public const INSTAGRAM_PATTERN = '/^[A-Za-z0-9._]{1,30}$/';

	/**
	 * Read the promotional profiles of the given team members.
	 *
	 * `members` holds exactly `id`, `sourceId`, `displayName`,
	 * `instagramHandle`, `websiteUrl`, `bio` and `portraitMediaId` per
	 * profile, sorted by numeric `sourceId`; repeated IDs appear once.
	 * `portraits` holds the {@see Source::describe()} result of each usable
	 * portrait, keyed by attachment ID, once even when several members share
	 * it, so the caller can add the matching `media` entries.
	 *
	 * @param int[] $member_ids Profile IDs the caller has resolved and authorized.
	 * @return array{members: array[], portraits: array<int, array>}|WP_Error
	 */
	public static function read( array $member_ids ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to read team member profiles.', 'fair-events-experimental' ),
				array( 'status' => is_user_logged_in() ? 403 : 401 )
			);
		}

		if ( ! Plugin::team_members_available() || ! TeamMemberRepository::is_installed() ) {
			return new WP_Error(
				'fair_events_team_directory_disabled',
				__( 'The team member directory is turned off on this site.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		$ids     = array();
		$invalid = array();
		foreach ( $member_ids as $id ) {
			$is_id = ( is_int( $id ) || ( is_string( $id ) && ctype_digit( $id ) ) ) && (int) $id > 0;
			if ( $is_id ) {
				$ids[ (int) $id ] = (int) $id;
			} else {
				$invalid[] = $id;
			}
		}
		if ( $invalid ) {
			return self::missing( $invalid );
		}
		ksort( $ids, SORT_NUMERIC );
		$ids = array_values( $ids );

		$rows = ( new TeamMemberRepository() )->promotional_rows_checked( $ids );
		if ( is_wp_error( $rows ) ) {
			return $rows;
		}

		$missing = array_values( array_diff( $ids, array_keys( $rows ) ) );
		if ( $missing ) {
			return self::missing( $missing );
		}

		$members   = array();
		$portraits = array();
		foreach ( $ids as $id ) {
			$row          = $rows[ $id ];
			$display_name = self::display_name( $row['name'], $row['surname'] );
			if ( null === $display_name ) {
				return new WP_Error(
					'fair_events_campaign_facts_member_name_missing',
					__( 'A team member has no name.', 'fair-events-experimental' ),
					array(
						'status'    => 422,
						'member_id' => $id,
					)
				);
			}

			$portrait_id = (int) $row['portrait_attachment_id'];
			$portrait    = null;
			if ( $portrait_id > 0 ) {
				if ( ! isset( $portraits[ $portrait_id ] ) ) {
					$described = Source::describe( $portrait_id );
					if ( ! empty( $described['ok'] ) ) {
						$portraits[ $portrait_id ] = $described;
					}
				}
				$portrait = isset( $portraits[ $portrait_id ] ) ? 'media:' . $portrait_id : null;
			}

			$members[] = array(
				'id'              => 'team-member:' . $id,
				'sourceId'        => $id,
				'displayName'     => $display_name,
				'instagramHandle' => self::instagram_handle( $row['instagram'] ),
				'websiteUrl'      => self::website_url( $row['website_url'] ),
				'bio'             => self::bio( $row['bio'] ),
				'portraitMediaId' => $portrait,
			);
		}

		ksort( $portraits, SORT_NUMERIC );

		return array(
			'members'   => $members,
			'portraits' => $portraits,
		);
	}

	/**
	 * Name and optional surname, trimmed and joined by one space.
	 *
	 * @param mixed $name    Stored name.
	 * @param mixed $surname Stored surname.
	 * @return string|null Display name, or null when both are blank.
	 */
	public static function display_name( $name, $surname ) {
		$parts = array_filter(
			array( self::text( $name ), self::text( $surname ) ),
			static function ( $part ) {
				return null !== $part;
			}
		);

		return $parts ? implode( ' ', $parts ) : null;
	}

	/**
	 * Instagram handle without surrounding whitespace or one leading `@`,
	 * or null when blank or not a valid handle.
	 *
	 * @param mixed $value Stored handle.
	 * @return string|null
	 */
	public static function instagram_handle( $value ) {
		$value = self::text( $value );
		if ( null === $value ) {
			return null;
		}

		if ( '@' === substr( $value, 0, 1 ) ) {
			$value = substr( $value, 1 );
		}

		return preg_match( self::INSTAGRAM_PATTERN, $value ) ? $value : null;
	}

	/**
	 * Whether a submitted handle is blank or exports as a valid handle.
	 *
	 * @param string $value Submitted handle.
	 * @return bool
	 */
	public static function is_valid_instagram( $value ) {
		return null === self::text( $value ) || null !== self::instagram_handle( $value );
	}

	/**
	 * Absolute http(s) website URL, or null when blank or malformed.
	 *
	 * @param mixed $value Stored URL.
	 * @return string|null
	 */
	public static function website_url( $value ) {
		$value = self::text( $value );

		return null !== $value && self::is_http_url( $value ) ? $value : null;
	}

	/**
	 * Whether a value is an absolute http(s) URL with a host.
	 *
	 * @param string $value Candidate URL.
	 * @return bool
	 */
	public static function is_http_url( $value ) {
		if ( ! filter_var( $value, FILTER_VALIDATE_URL ) ) {
			return false;
		}

		$parts  = wp_parse_url( $value );
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );

		return in_array( $scheme, array( 'http', 'https' ), true ) && '' !== (string) ( $parts['host'] ?? '' );
	}

	/**
	 * Plain-text bio with its line breaks kept as `\n`, or null when blank.
	 *
	 * @param mixed $value Stored bio.
	 * @return string|null
	 */
	public static function bio( $value ) {
		$value = self::text( $value );

		return null === $value ? null : str_replace( array( "\r\n", "\r" ), "\n", $value );
	}

	/**
	 * Trimmed text, with blank values as null.
	 *
	 * @param mixed $value Stored value.
	 * @return string|null
	 */
	private static function text( $value ) {
		if ( null === $value || ! is_scalar( $value ) ) {
			return null;
		}

		$value = trim( (string) $value );

		return '' === $value ? null : $value;
	}

	/**
	 * Error for requested IDs without a profile.
	 *
	 * @param array $member_ids The IDs.
	 * @return WP_Error
	 */
	private static function missing( array $member_ids ) {
		return new WP_Error(
			'fair_events_team_member_missing',
			__( 'A team member of this event could not be found.', 'fair-events-experimental' ),
			array(
				'status'     => 500,
				'member_ids' => array_values( $member_ids ),
			)
		);
	}
}
