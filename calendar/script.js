import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css'; // CSS 파일을 import 해야 합니다

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
        <div className={`lesson-card ${student.type === 'Private' ? 'private' : 'group'}`}
             draggable="true"
             onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify(student))}>
            <i className={`icon ${student.type === 'Private' ? 'person' : 'person-group'}`}></i>
            <strong>{student.name}</strong>
        </div>
    );
}

function App() {
    const [students, setStudents] = useState([]);

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

    const handleDrop = (day, time, studentData) => {
        const updatedStudents = students.map(student => {
            if (student.id === studentData.id) {
                const updatedLessons = student.lessons.map(lesson => 
                    lesson.id === studentData.lessons[0].id ? { ...lesson, day, startTime: time } : lesson
                );
                return { ...student, lessons: updatedLessons };
            }
            return student;
        });
        setStudents(updatedStudents);
    };

    return (
        <div className="app-container">
            {students.length === 0 ? (
                <div>
                    <h2>No Students Found</h2>
                    <button onClick={addSampleData}>Add Sample Data</button>
                </div>
            ) : (
                <WeeklyCalendarView students={students} handleDrop={handleDrop} />
            )}
        </div>
    );
}

function WeeklyCalendarView({ students, handleDrop }) {
    const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const timeSlots = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"];

    const onDrop = (e, day, time) => {
        e.preventDefault();
        const studentData = JSON.parse(e.dataTransfer.getData('text'));
        handleDrop(day, time, studentData);
    };

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
                            onDrop={(e) => onDrop(e, day, time)}
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

const root = createRoot(document.getElementById('root'));
root.render(<App />);