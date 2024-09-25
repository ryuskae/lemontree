import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

class Student {
    constructor(name, lessons = [], type = 'Private') {
        this.id = this.generateUUID();
        this.name = name;
        this.lessons = lessons;
        this.type = type;
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0,
                v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

class Lesson {
    constructor(day, startTime) {
        this.id = this.generateUUID();
        this.day = day;
        this.startTime = startTime;
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0,
                v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

function StudentCard({ student }) {
    return (
        <div className={`lesson-card ${student.type === 'Private' ? 'private' : 'group'}`}>
            <i className={`icon ${student.type === 'Private' ? 'person' : 'person-group'}`}></i>
            <strong>{student.name}</strong>
        </div>
    );
}

function App() {
    const [students, setStudents] = useState([]);
    const [draggedLesson, setDraggedLesson] = useState(null);

    useEffect(() => {
        if (students.length === 0) {
            addSampleData();
        }
    }, [students]);

    const addSampleData = () => {
        const student1 = new Student("John Doe", [
            new Lesson("Sat", "4:00 PM"),
            new Lesson("Wed", "2:00 PM")
        ], "Group");

        const student2 = new Student("Jane Smith", [
            new Lesson("Sat", "4:00 PM"),
            new Lesson("Thu", "3:00 PM")
        ], "Private");

        setStudents([student1, student2]);
    };

    return (
        <div className="app-container">
            {students.length === 0 ? (
                <div>
                    <h2>No Students Found</h2>
                    <button onClick={addSampleData}>Add Sample Data</button>
                </div>
            ) : (
                <WeeklyCalendarView students={students} setDraggedLesson={setDraggedLesson} />
            )}
        </div>
    );
}

function WeeklyCalendarView({ students, setDraggedLesson }) {
    const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const timeSlots = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"];

    return (
        <div className="calendar">
            <div className="calendar-header">
                <div>Time</div>
                {daysOfWeek.map((day, index) => (
                    <div key={index}>{day}</div>
                ))}
            </div>

            {timeSlots.map((time, index) => (
                <div className="calendar-row" key={index}>
                    <div className="time-slot">{time}</div>
                    {daysOfWeek.map((day, idx) => (
                        <div
                            key={idx}
                            className="calendar-cell"
                            onDrop={(e) => handleDrop(e, day, time)}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            {students.map((student) => (
                                student.lessons.map((lesson) => (
                                    lesson.day === day && lesson.startTime === time && (
                                        <StudentCard key={lesson.id} student={student} />
                                    )
                                ))
                            ))}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function handleDrop(event, day, time) {
    event.preventDefault();
    console.log(`Dropped on ${day} at ${time}`);
}

ReactDOM.render(<App />, document.getElementById('root'));