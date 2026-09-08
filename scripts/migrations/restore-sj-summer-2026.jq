# Rebuild SJ's completed Summer 2026 course archive from the mixed June legacy
# snapshot. Only the three user-confirmed SJ courses are selected; every other
# course in the source snapshot is deliberately excluded.

def trimmed:
  if type == "string" then gsub("^\\s+|\\s+$"; "") else "" end;

def is_target_code:
  ((. // "") | tostring | ascii_upcase | gsub("\\s"; ""))
  | test("^CMPT(276|295|310)([^0-9]|$)");

def is_target_canvas_id:
  ((. // "") | tostring) as $id
  | $id == "14919" or $id == "14920";

def lecture_code:
  .friendlyCourseCode // .courseCode // .originalCourseCode // .code // "";

def is_target_lecture:
  (lecture_code | is_target_code)
  or ((.courseId // "") | is_target_canvas_id)
  or ((.id // "") | test("^manual-canvas-(14919|14920)$"));

def is_target_item:
  ((.courseCode // .course // "") | is_target_code)
  or ((.courseId // .retainedFromCanvasCourseId // "") | is_target_canvas_id)
  or ((.id // "") | test("^manual-canvas-(coursework|assessment)-(14919|14920)-"));

def default_schedule:
  {
    deliveryMode: "inPerson",
    day: "",
    time: "",
    location: "",
    entries: []
  };

def manual_lecture_from_canvas($course_id; $preference):
  ($preference.friendlyCourseCode // $preference.originalCourseCode // $course_id) as $code
  | ($preference.friendlyName // $preference.courseName // $code) as $name
  | {
      id: "manual-canvas-\($course_id)",
      name: $name,
      code: $code,
      lectureSection: ($preference.lectureSection // ""),
      labSection: ($preference.labSection // ""),
      tutorialSection: ($preference.tutorialSection // ""),
      credits: ($preference.credits // ""),
      assessments: ($preference.assessments // []),
      schedule: ($preference.schedule // default_schedule),
      links: (
        if (($preference.links // []) | length) > 0 then
          $preference.links
        elif ($preference.htmlUrl // "") != "" then
          [{
            id: "\($course_id)-canvas-link",
            label: "Canvas course",
            url: $preference.htmlUrl
          }]
        else
          []
        end
      ),
      friendlyCourseCode: $preference.friendlyCourseCode,
      friendlyName: $preference.friendlyName,
      starred: $preference.starred,
      chipColor: $preference.chipColor,
      canvasGradeSummary: {
        grade: $preference.currentGrade,
        score: $preference.currentScore
      },
      semester: ($preference.semester // $preference.termName // "Summer 2026")
    }
  | with_entries(select(.value != null));

def manual_coursework_from_canvas($course_id; $item_id; $preference; $course):
  (($preference.title // "") | trimmed) as $title
  | (($preference.courseCode // "") | trimmed) as $course_code
  | {
    id: "manual-canvas-coursework-\($course_id)-\($item_id)",
    title: (if $title == "" then "Coursework" else $title end),
    courseCode: (
      if $course_code != "" then $course_code
        else ($course.friendlyCourseCode // $course.originalCourseCode // $course_id)
      end
    ),
    dueAt: ($preference.dueAt // $preference.startAt // $preference.endAt // ""),
    startAt: $preference.startAt,
    endAt: $preference.endAt,
    courseworkType: ($preference.courseworkType // "assignment"),
    submissionType: ($preference.submissionType // "assignment"),
    completed: (($preference.isSubmitted // false) or ($preference.completed // false)),
    completedAt: ($preference.submittedAt // $preference.completedAt),
    chipColor: $course.chipColor,
    hidden: $preference.hidden,
    retainedFromCanvasCourseId: $course_id,
    semester: ($preference.semester // $course.semester // $course.termName // "Summer 2026"),
    starred: $preference.starred
  }
  | with_entries(select(.value != null));

def manual_assessment_from_canvas($course_id; $item_id; $preference; $course):
  (($preference.title // "") | trimmed) as $title
  | (($preference.courseCode // "") | trimmed) as $course_code
  | {
    id: "manual-canvas-assessment-\($course_id)-\($item_id)",
    title: (if $title == "" then "Assessment" else $title end),
    courseCode: (
      if $course_code != "" then $course_code
        else ($course.friendlyCourseCode // $course.originalCourseCode // $course_id)
      end
    ),
    dueAt: ($preference.dueAt // $preference.startAt // $preference.endAt // ""),
    startAt: $preference.startAt,
    endAt: $preference.endAt,
    assessmentType: ($preference.assessmentType // "quiz"),
    completed: (($preference.isSubmitted // false) or ($preference.completed // false)),
    completedAt: ($preference.submittedAt // $preference.completedAt),
    hidden: $preference.hidden,
    retainedFromCanvasCourseId: $course_id,
    semester: ($preference.semester // $course.semester // $course.termName // "Summer 2026"),
    starred: $preference.starred
  }
  | with_entries(select(.value != null));

(.[] | select(.UserKey == "sj@incos.co.kr" and .SettingKey == "academy.preferences") | .SettingJson) as $source
| ($source.canvasLecturePreferences // {}) as $source_canvas_lectures
| ($source_canvas_lectures
    | with_entries(select(.key | is_target_canvas_id))) as $target_canvas_lectures
| ($target_canvas_lectures
    | to_entries
    | map(manual_lecture_from_canvas(.key; .value))) as $converted_lectures
| ($source.manualLectures // []
    | map(select(is_target_lecture))) as $source_manual_lectures
| ($source.manualCoursework // []
    | map(select(is_target_item))) as $source_manual_coursework
| ($source.canvasCourseworkPreferences // {}
    | with_entries(select(.value.courseId | is_target_canvas_id))) as $target_canvas_coursework
| ($target_canvas_coursework
    | to_entries
    | map(
        .value.courseId as $course_id
        | manual_coursework_from_canvas(
            $course_id;
            .key;
            .value;
            $source_canvas_lectures[$course_id]
          )
      )) as $converted_coursework
| ($source.manualAssessments // []
    | map(select(is_target_item))) as $source_manual_assessments
| ($source.canvasAssessmentPreferences // {}
    | with_entries(select(.value.courseId | is_target_canvas_id))) as $target_canvas_assessments
| ($target_canvas_assessments
    | to_entries
    | map(
        .value.courseId as $course_id
        | manual_assessment_from_canvas(
            $course_id;
            .key;
            .value;
            $source_canvas_lectures[$course_id]
          )
      )) as $converted_assessments
| ($current.canvasLecturePreferences // {}
    | with_entries(select(
        ((.key | is_target_canvas_id)
          or (.value | is_target_lecture))
        | not
      ))) as $current_other_canvas_lectures
| ($current.canvasCourseworkPreferences // {}
    | with_entries(select((.value | is_target_item) | not))) as $current_other_canvas_coursework
| ($current.canvasAssessmentPreferences // {}
    | with_entries(select((.value | is_target_item) | not))) as $current_other_canvas_assessments
| $current
  + {
      manualLectures: (
        ($current.manualLectures // [] | map(select(is_target_lecture | not)))
        + $source_manual_lectures
        + $converted_lectures
      ),
      canvasLecturePreferences: (
        $current_other_canvas_lectures
        + ($target_canvas_lectures
          | map_values(. + {
              convertedToManualAt: $convertedAt,
              deleted: true,
              hidden: true
            }))
      ),
      manualCoursework: (
        ($current.manualCoursework // [] | map(select(is_target_item | not)))
        + $source_manual_coursework
        + $converted_coursework
      ),
      canvasCourseworkPreferences: (
        $current_other_canvas_coursework
        + ($target_canvas_coursework | map_values(. + {hidden: true}))
      ),
      manualAssessments: (
        ($current.manualAssessments // [] | map(select(is_target_item | not)))
        + $source_manual_assessments
        + $converted_assessments
      ),
      canvasAssessmentPreferences: (
        $current_other_canvas_assessments
        + ($target_canvas_assessments | map_values(. + {hidden: true}))
      ),
      calendarSettings: (
        ($current.calendarSettings // {})
        + {
            selectedSemester: "Summer 2026",
            lastCanvasTermName: "Summer 2026"
          }
      )
    }
